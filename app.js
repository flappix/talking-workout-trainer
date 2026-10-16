
function App() {
	return {
		init: function() {
			let workouts = this.load_stored_workouts();
			Speakit.getVoices().then ( voices => {
				this.voices = voices;

				this.workouts = workouts != null ? workouts : get_demo_workouts (this.voices);

				this.curr_workout = parseInt ( localStorage.getItem ('last_workout') );

				if ( isNaN (this.curr_workout) || this.curr_workout < 0 || this.curr_workout >= this.workouts.length ) {
					this.curr_workout = this.workouts.length - 1;
				}
				
				// get shared workout
				const params = new Proxy (new URLSearchParams (window.location.search), {
					get: (searchParams, prop) => searchParams.get (prop),
				});
				if (params.share_workout)
				{
					let share_workout = null;
					try {
						share_workout = JSON.parse (params.share_workout);
					}
					catch (e) {}

					let error = share_workout == null ? 'not valid JSON' : this.get_workouts_error ([share_workout]);
					if (error) {
						alert (`Could not import shared workout: ${error}`);
					}
					// avoid duplicates
					else if ( !this.workout_exists (share_workout) )
					{
						this.workouts.push (share_workout);
						this.curr_workout = this.workouts.length - 1;
						this.store();
					}
					
					document.location.href = document.location.href.split ('?')[0];
					
				}
				
				this.curr_exercise.exercise = 0;
				this.curr_exercise.period = 'work';
				this.curr_exercise.remaining_time = this.get_curr_workout().settings.pre_delay * 1000;
				
				this.reset_temp_workout();
				
				this.state = 'not_started';
				this.nosleep = new NoSleep();
				
				this.energy_saving_mode = localStorage.getItem ('energy_saving_mode', 'false') == 'true';
			});
		},
		// returns the stored workouts or null if there are none or they are invalid
		load_stored_workouts: function() {
			let stored = localStorage.getItem ('workouts');
			if (stored == null) {
				return null;
			}

			let workouts = null;
			let error = null;
			try {
				workouts = JSON.parse (stored);
				error = this.get_workouts_error (workouts);
			}
			catch (e) {
				error = 'not valid JSON';
			}

			if (error) {
				// keep the broken data so it is not lost when the demo workouts are stored
				localStorage.setItem ('workouts_invalid', stored);
				alert (`Your stored workouts could not be loaded (${error}). The demo workouts are loaded instead, your old data is kept in localStorage under "workouts_invalid".`);
				return null;
			}

			return workouts;
		},
		find_best_voice: function() {
			for (let config of [['name', 'Aaron'], ['name', 'Fred'], ['lang', 'en-US']]) {
				for (let v in this.voices)
				{
					let voice = this.voices[v];
					if (voice[config[0]] == config[1]) {
						return v;
					}
				}
			}
	
			return 0;
		},
		get_voice: function (name) {
			if (name == '_default_') {
				return this.find_best_voice();
			}
			
			for (let v in this.voices)
			{
				let voice = this.voices[v];
				if (voice.name == name) {
					return v;
				}
			}
			
			return 0;
		},
		panel: 'run',
		workouts: [],
		curr_workout: null,
		workout_template: {
			name: '',
			settings: {
				pre_delay: 5,
				count_down: 3,
				work_period: 45,
				rest_period: 15,
				voice: '_default_'
			},
			exercises: [],
			completed: 0
		},
		reset_temp_workout: function() {
			this.temp_workout = _.cloneDeep (this.workout_template);
			this.edit_workout = null;
		},
		add_exercise: function() {
			this.temp_workout.exercises.push ({name: '', work_period: 'default', rest_period: 'default'});
			setTimeout ( () => {
				document.getElementById (`exercise_${this.temp_workout.exercises.length - 1}`).scrollIntoView ({behavior: 'smooth'});
				document.getElementById (`exercise_name_${this.temp_workout.exercises.length - 1}`).focus();
			}, 200 );
		},
		save_workout: function() {
			// overwrite current workout
			if (this.curr_workout != null) {
				this.workouts[this.curr_workout] = this.temp_workout;
			}
			// create new workout
			else {
				this.workouts.push (this.temp_workout);
				this.curr_workout = this.workouts.length - 1;
			}
			
			this.store();
			this.reset_temp_workout();
			this.panel = 'run';
			this.state = 'not_started';
		},
		duplicate_workout: function (w) {
			this.workouts.splice (w, 0, _.cloneDeep (this.workouts[w]) );
			if (this.curr_workout >= w) {
				this.curr_workout++;
			};
			this.store();
		},
		delete_workout: function (w) {
			if ( confirm (`Are you sure you want to delete ${this.workouts[w].name} ?`) ) {
				this.workouts.splice (w, 1);
				if ( this.curr_workout > w || (this.curr_workout == w && w > 0) ) {
					this.curr_workout--;
				};
				this.store();
			}
		},
		cancel_edit_workout: function() {
			let has_changed = ( this.edit_workout == null && !_.isEqual (this.temp_workout, this.workout_template) ) || // new workout
							  ( this.edit_workout != null && !_.isEqual ( _.cloneDeep (this.workouts[this.edit_workout]), this.temp_workout ) ); // edit workout
			if ( !has_changed || confirm ('Are you sure you want to exit the workout editor? Your workout will not be saved') ) {
				this.curr_workout = localStorage.getItem ('last_workout') || 0;
				this.reset_temp_workout();
				this.panel = 'run';
				this.state = 'not_started';
			}
		},
		temp_workout: null,
		edit_workout: null, // changed workout will be compared to this to check if anything has changed
			
		
		curr_exercise: {},
		get_curr_workout: function() {
			return this.workouts[this.curr_workout];
		},
		get_exercises: function  (workout=null) {
			if (workout == null) {
				workout = this.get_curr_workout();
			}
			if (this.shuffle && workout.shuffle_exercises) {
				return workout.shuffle_exercises;
			}
			// else
			return workout.exercises;
		},
		state: 'not_init',
		last_countdown: Infinity,
		phase_end: null, // timestamp when the current phase (pre-delay, work, rest) ends, null until the timer runs
		speech_lead: 300, // countdown numbers are spoken this many ms early to compensate the speech delay (iOS)
		run_timer: null,
		run_id: 0, // incremented on start and quit, so stale run loops and start callbacks stop
		// schedule the next tick at the next full second (display, phase change) or countdown announcement
		schedule_run: function() {
			clearTimeout (this.run_timer);

			let remaining = this.phase_end - Date.now();
			let until_next = ms => ( (ms % 1000) + 1000 ) % 1000 || 1000;
			let delay = remaining <= 0 ? 0 : Math.min ( until_next (remaining), until_next (remaining - this.speech_lead) );

			let run_id = this.run_id;
			this.run_timer = setTimeout ( () => { this.run (run_id); }, delay + 5 );
		},
		// start the next phase where the last one ended (not now), so late ticks don't add up
		start_phase: function (period, now) {
			this.phase_end += period;
			this.curr_exercise.remaining_time = this.phase_end - now;
			this.update_progressbar ('exercise', period, period - this.curr_exercise.remaining_time);
		},
		run: function (run_id) {
			if (run_id != this.run_id || this.pause) {
				return;
			}

			let now = Date.now();
			let finished = false;

			let curr_workout = this.get_curr_workout();
			let exercises = this.get_exercises();
			this.curr_exercise.remaining_time = this.phase_end - now;

			// countdown
			let remain = Math.ceil ( (this.curr_exercise.remaining_time - this.speech_lead) / 1000 );
			if (remain <= curr_workout.settings.count_down && remain > 0) {

				if (this.last_countdown > remain && !this.reading) {
					this.readText (remain);
					this.last_countdown = remain;
				}
			}

			if (this.curr_exercise.remaining_time <= 0) {

				if (this.state == 'pre_delay') {
					this.curr_exercise.period = 'work';
					this.readText (`go! ${exercises[this.curr_exercise.exercise].name}`);
					this.state = 'running';
					this.start_phase (this.get_work_period(), now);

					// the workout started when the pre-delay ended (possibly a bit before this tick)
					this.update_progressbar ( 'workout', this.getWorkoutDuration (curr_workout), this.get_work_period() - this.curr_exercise.remaining_time );

					this.last_countdown = Infinity;
				}
				else if (this.curr_exercise.period == 'work' && curr_workout.exercises.length - 1 > this.curr_exercise.exercise) {
					this.curr_exercise.period = 'rest';
					this.last_countdown = Infinity;

					this.readText ('Rest').then ( () => {
						let next_speak = () => this.readText (`${this.curr_exercise.exercise < curr_workout.exercises.length - 2 ? 'Next' : 'Last'} exercise: ${exercises[this.curr_exercise.exercise + 1].name}`);

						if ( this.get_rest_period (curr_workout, exercises[this.curr_exercise.exercise]) > 1 && curr_workout.exercises.length - 1 > this.curr_exercise.exercise &&
							 Math.round (curr_workout.exercises.length / 2) - 1 == this.curr_exercise.exercise )
						{
							this.readText ('Half way there').then ( () => next_speak() );
						}
						else {
							next_speak();
						}
					});

					this.start_phase (this.get_rest_period(), now);
				}
				else { // rest
					this.curr_exercise.period = 'work';
					this.last_countdown = Infinity;

					if (curr_workout.exercises.length - 1 > this.curr_exercise.exercise) {
						this.curr_exercise.exercise++;
						this.readText (`go! ${exercises[this.curr_exercise.exercise].name}`);
						this.start_phase (this.get_work_period(), now);
					}
					else {
						this.readText ('Workout finished');
						this.state = 'finished';
						this.stop_animation ('exercise');
						this.stop_animation ('workout');
						curr_workout.completed = (curr_workout.completed ?? 0) + 1;
						this.store();

						finished = true;
						this.phase_end = null;
						this.last_countdown = Infinity;
						this.nosleep.disable();
					}
				}
			}

			if (!finished) {
				this.schedule_run();
			}
		},
		get_work_period: function (workout = null, exercise = null) {
			if (workout == null) {
				workout = this.get_curr_workout();
			}
			
			if (exercise == null)
			{
				exercise = this.get_exercises (workout)[this.curr_exercise.exercise];
			}
			
			let work_period = workout.settings.work_period;
			if (exercise.work_period != 'default') {
				work_period = exercise.work_period;
			}
			
			return work_period * 1000;
		},
		get_rest_period: function (workout = null, exercise = null) {
			if (workout == null) {
				workout = this.get_curr_workout();
			}
			
			if (exercise == null)
			{
				exercise = this.get_exercises (workout)[this.curr_exercise.exercise];
			}
			
			let rest_period = workout.settings.rest_period;
			if (exercise.rest_period != 'default') {
				rest_period = exercise.rest_period;
			}
			
			return rest_period * 1000;
		},
		load_workout: function (index) {
			this.curr_workout = index;
			this.store();
			this.panel = 'run';
			this.state = 'not_started';
		},
		start_workout: function() {
			let curr_workout = this.get_curr_workout();
			if (this.shuffle) {
				curr_workout.shuffle_exercises = this.shuffle_workout (curr_workout);
			}
			
			this.curr_exercise.exercise = 0;
			this.curr_exercise.period = 'work';
			this.curr_exercise.remaining_time = curr_workout.settings.pre_delay * 1000;
			this.state = 'pre_delay';
			this.pause = false;
			this.phase_end = null;

			this.nosleep.enable();

			let run_id = ++this.run_id;
			let start = () => {
				// workout was quit (or restarted) while the intro was spoken
				if (run_id != this.run_id) {
					return;
				}

				this.phase_end = Date.now() + this.curr_exercise.remaining_time;
				this.update_progressbar ('exercise', this.curr_exercise.remaining_time);
				this.run (run_id); // does nothing while paused, continuing restarts the timer
			};
			
			this.readText ('First exercise: ' + this.get_exercises()[this.curr_exercise.exercise].name).then ( () => {
				if (curr_workout.settings.pre_delay > 0) {
					this.readText (`Starting in ${curr_workout.settings.pre_delay} second${curr_workout.settings.pre_delay != 1 ? 's' : ''}`).then (start);
				}
				else {
					start();
				}
			});
			
			
		},
		pause: false,
		pause_workout: function() {
			this.pause = !this.pause;
			
			if (!this.energy_saving_mode) {
				if (document.styleSheets[1].cssRules[0]) {
					document.styleSheets[1].cssRules[0].style.animationPlayState = this.pause ? 'paused' : 'running';
				}
				
				// catch pre_delay phase
				if (document.styleSheets[2].cssRules.length > 0) {
					document.styleSheets[2].cssRules[0].style.animationPlayState = this.pause ? 'paused' : 'running';
				}
			}
			
			if (this.pause) {
				this.nosleep.disable();
			}
			else
			{
				this.nosleep.enable();
			}

			// the timer only runs after the intro was spoken (phase_end is set)
			if (this.phase_end != null) {
				if (this.pause) {
					// stop the timer while paused and remember the remaining time
					clearTimeout (this.run_timer);
					this.curr_exercise.remaining_time = this.phase_end - Date.now();
				}
				else {
					this.phase_end = Date.now() + this.curr_exercise.remaining_time;
					this.schedule_run();
				}
			}
		},
		is_running: function() {
			return ['pre_delay', 'running'].includes (this.state);
		},
		stop_workout: function() {
			if ( this.is_running() ) {
				this.quit_workout();
			}

			this.nosleep.disable();
		},
		quit_workout: function() {
			this.run_id++; // stops the run loop and a pending start
			clearTimeout (this.run_timer);
			this.phase_end = null;
			this.stop_animation ('exercise');
			this.stop_animation ('workout');
			this.curr_exercise.exercise = 0;
			this.curr_exercise.period = 'work';
			this.curr_exercise.remaining_time = this.get_curr_workout().settings.pre_delay * 1000;
			this.state = 'not_started';
			this.pause = false;
			this.last_countdown = Infinity;
			this.nosleep.disable();
		},
		store: function() {
			let _workouts = _.cloneDeep (this.workouts);
			for (let w of _workouts) {
				if ('shuffle_exercises' in w) {
					delete w.shuffle_exercises;
				}
			}
			
			localStorage.setItem ('workouts', JSON.stringify (_workouts) );
			localStorage.setItem ('last_workout', this.curr_workout);
		},
		// duration of the workout, starting at exercise `from`
		getWorkoutDuration: function (workout, from = 0) {
			let exercises = this.get_exercises (workout);
			return exercises.reduce ( (sum, x, i) => i < from ? sum : sum + this.get_work_period (workout, x) + ( i < exercises.length - 1 ? this.get_rest_period (workout, x) : 0 ) , 0 );
		},
		// time: total duration of the animation, elapsed: how much of it has already passed
		update_progressbar: function (type, time, elapsed = 0) {
			if (!this.energy_saving_mode) {
				let style = document.styleSheets[type == 'exercise' ? 1 : 2];
				if (style.cssRules.length > 0) {
					this.stop_animation (type);
				}

				// negative delay starts the animation part way through
				let animation = `animation: prixClipFix_${type} ${time / 1000}s linear ${-elapsed / 1000}s 1;
					animation-play-state: ${this.pause ? 'paused' : 'running'};`;

				if (type == 'exercise') {
					style.addRule ('exercise_timer::before',`content: "";
						box-sizing: border-box;
						position: absolute;
						inset: 0px;
						border-radius: 50%;
						border: 1rem solid black;
						transform: rotate(45deg);
						${animation}`
					);
				}
				else // workout
				{
					style.addRule ('workout_timer::before', `
						content: "";
						box-sizing: border-box;
						position: absolute;
						inset: 0px;
						border-radius: 50%;
						border: 1rem solid #616161;
						transform: rotate(45deg);
						${animation}
					`);
				}
			}
		},
		stop_animation: function (type) {
			if (!this.energy_saving_mode) {
				let style = document.styleSheets[type == 'exercise' ? 1 : 2];
				if (style.cssRules.length > 0) {
					style.removeRule (0);
				}
				
				for ( let anim of document.getAnimations() ) {
					// getAnimations() also returns CSS transitions (e.g. buttons), which have no animationName
					if ( anim instanceof CSSAnimation && anim.animationName.includes (type) ) {
						anim.cancel();
					}
				}
				
				let element = document.getElementById (type + '_timer');
				if (element) {
					element.style.animation = 'none';
					element.offsetHeight; /* trigger reflow */
					element.style.animation = null; 
				}
			}
		},
		secondsToTime: function(e) {
			const m = Math.floor(e % 3600 / 60).toString().padStart(2,'0'),
				  s = Math.floor(e % 60).toString().padStart(2,'0');	
			return m + ':' + s;
		},
		
		reading: false,
		readText: function (text, workout=null) {
			// skip text while another one is being read, but always return a promise so callers can chain .then()
			if (this.reading) {
				return Promise.resolve();
			}

			this.reading = true;
			if (workout == null) {
				workout = this.get_curr_workout();
			}

			let voice = this.voices[this.get_voice (workout.settings.voice)];
			return Speakit.readText (text, voice.lang, voice.name)
				.catch ( error => console.error ('speech failed', error) )
				.finally ( () => { this.reading = false; } );
		},
		share_workout: function (workout) {
			let url = window.location.href.split('?')[0];
			//console.log ( url + '?share_workout=' + encodeURIComponent ( JSON.stringify ( _.omit (workout, ['completed']) ) ) );
		},
		shuffle: false,
		shuffle_workout: function (workout) {
			let exercises = [...workout.exercises];
			for (let i = exercises.length - 1; i > 0; i--) {
				const j = Math.floor ( Math.random() * (i + 1) );
				[exercises[i], exercises[j]] = [exercises[j], exercises[i]];
			}
			
			return exercises;
		},
		
		show_import: false,
		exercises_import_str: '',
		import_exercises: function() {
			for ( let exercise_name of this.exercises_import_str.split ('\n') ) {
				if ( this.temp_workout.exercises.filter ( exercise => exercise.name == exercise_name ).length == 0 ) {
					this.temp_workout.exercises.push ({name: exercise_name, work_period: 'default', rest_period: 'default'});
				}
			}
			
			this.show_import = false;
			this.exercises_import_str = '';
		},
		
		jump_to_exercise: function (step) {
			let new_exercise = this.curr_exercise.exercise + step;
			if (0 <= new_exercise && new_exercise <= this.get_exercises().length - 1) {
				this.curr_exercise.exercise = new_exercise;
				this.curr_exercise.period = 'work';
				this.curr_exercise.remaining_time = this.get_work_period();
				this.phase_end = Date.now() + this.curr_exercise.remaining_time;
				if (!this.pause) {
					this.schedule_run(); // realign the ticks to the new phase
				}

				this.update_progressbar ('exercise', this.curr_exercise.remaining_time);

				// continue the workout ring at the position of the new exercise
				let workout = this.get_curr_workout();
				let total = this.getWorkoutDuration (workout);
				this.update_progressbar ( 'workout', total, total - this.getWorkoutDuration (workout, new_exercise) );
				
				this.last_countdown = Infinity;
				
				this.readText ( this.get_exercises()[this.curr_exercise.exercise].name );
			}
		},
		
		validate_backup: null,
		// validate a list of workouts against the backup schema; returns an error message or null
		get_workouts_error: function (workouts) {
			if (this.validate_backup == null) {
				this.validate_backup = new ajv7().compile ( get_backup_schema() );
			}
			if ( !this.validate_backup (workouts) ) {
				let error = this.validate_backup.errors[0];
				return `workouts${error.instancePath} ${error.message}`;
			}

			return null;
		},
		// check if an identical workout already exists (ignoring the completed counter)
		workout_exists: function (workout, workouts = this.workouts) {
			let compare = w => _.omit (w, ['completed', 'shuffle_exercises']);
			return workouts.some ( existing => _.isEqual ( compare (existing), compare (workout) ) );
		},
		download_backup: function() {
			let _workouts = _.cloneDeep (this.workouts);
			for (let w of _workouts) {
				if ('shuffle_exercises' in w) {
					delete w.shuffle_exercises;
				}
			}

			let backup = {
				app: 'talking-workout-trainer',
				version: 1,
				created: new Date().toISOString(),
				last_workout: this.curr_workout,
				workouts: _workouts
			};

			let blob = new Blob ([JSON.stringify (backup, null, 2)], {type: 'application/json'});
			let url = URL.createObjectURL (blob);
			let link = document.createElement ('a');
			link.href = url;
			link.download = `workouts_${new Date().toISOString().slice (0, 10)}.json`;
			document.body.appendChild (link);
			link.click();
			document.body.removeChild (link);
			setTimeout ( () => URL.revokeObjectURL (url), 1000 );
		},
		restore_backup: function (event) {
			let file = event.target.files[0];
			event.target.value = ''; // allow selecting the same file again
			if (!file) {
				return;
			}

			let reader = new FileReader();
			reader.onload = () => {
				let backup;
				try {
					backup = JSON.parse (reader.result);
				}
				catch (e) {
					alert ('Restore failed: the file is not valid JSON');
					return;
				}

				// accept a backup object or a plain array of workouts
				let workouts = Array.isArray (backup) ? backup : backup?.workouts;

				let error = this.get_workouts_error (workouts);
				if (error) {
					alert (`Restore failed: invalid backup file\n\n${error}`);
					return;
				}

				// fill in missing settings
				for (let w of workouts) {
					w.settings = Object.assign ( _.cloneDeep (this.workout_template.settings), w.settings );
				}

				// skip workouts which already exist
				let new_workouts = [];
				for (let w of workouts) {
					if ( !this.workout_exists (w, [...this.workouts, ...new_workouts]) ) {
						new_workouts.push (w);
					}
				}

				if (new_workouts.length == 0) {
					alert ('Nothing to restore: all workouts in the file already exist');
					return;
				}

				let skipped = workouts.length - new_workouts.length;
				let skipped_str = skipped > 0 ? `\n(${skipped} already existing workout${skipped != 1 ? 's' : ''} will be skipped)` : '';
				if ( !confirm (`Add ${new_workouts.length} workout${new_workouts.length != 1 ? 's' : ''} from backup?${skipped_str}`) ) {
					return;
				}

				this.workouts.push (...new_workouts);
				this.store();
			};
			reader.onerror = () => alert ('Restore failed: the file could not be read');
			reader.readAsText (file);
		},

		energy_saving_mode: false,
		toggleEnergySavingMode: function() {
			this.energy_saving_mode = !this.energy_saving_mode;
			localStorage.setItem ('energy_saving_mode', this.energy_saving_mode);
		}
	};
}
