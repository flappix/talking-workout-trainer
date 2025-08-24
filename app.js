
function App() {
	return {
		init: function() {
			let workouts = JSON.parse ( localStorage.getItem ('workouts') );
			Speakit.getVoices().then ( voices => {
				this.voices = voices;
				
				this.workouts = workouts != null ? workouts : get_demo_workouts (this.voices);

				this.curr_workout = localStorage.getItem ('last_workout');
				if (this.curr_workout == null) {
					this.curr_workout = this.workouts.length - 1;
				}
				
				// get shared workout
				const params = new Proxy (new URLSearchParams (window.location.search), {
					get: (searchParams, prop) => searchParams.get (prop),
				});
				if (params.share_workout)
				{
					let share_workout = JSON.parse (params.share_workout);
					
					// avoid duplicates
					if ( this.workouts.filter ( w => JSON.stringify (w) == params.share_workout ).length == 0 )
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
				
				
				this.beep1 = new Howl({
					src: ['resources/beep1.wav'],
					html5: true
				});
				this.beep2 = new Howl({
					src: ['resources/beep2.wav'],
					html5: true
				});
				
				this.state = 'not_started';
				this.nosleep = new NoSleep();
			});
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
		delete_workout: function (w) {
			if ( confirm (`Are you sure you want to delete ${this.workouts[w].name} ?`) ) {
				this.workouts.splice (w, 1);
				if (this.curr_workout == w) {
					this.curr_workout--;
				};
				this.store();
			}
		},
		cancel_edit_workout: function() {
			let has_changed = ( this.edit_workout == null && !_.isEqual (this.temp_workout, this.workout_template) ) || // new workout
							  ( this.edit_workout != null && !_.isEqual ( _.cloneDeep (this.workouts[this.edit_workout]), this.temp_workout ) ); // edit workout
			if ( !has_changed || confirm ('Are you sure you want to exit the workout editor? Your workout will not be saved') ) {
				this.curr_workout = localStorage.getItem ('last_workout', 0)
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
			if (this.shuffle) {
				return workout.shuffle_exercises;
			}
			// else
			return workout.exercises;
		},
		state: 'not_init',
		last_time: null,
		last_countdown: Infinity,
		run: function() {
			let time = Date.now();
			let time_diff = time - this.last_time;
			this.last_time = time;
			
			let finished = false;
			
			if (this.quit) {
				this.stop_animation ('exercise');
				this.stop_animation ('workout');
				this.curr_exercise.exercise = 0;
				this.curr_exercise.period = 'work';
				this.curr_exercise.remaining_time = this.get_curr_workout().settings.pre_delay * 1000;
				this.state = 'not_started';
				this.quit = false;
				this.last_countdown = Infinity;
				return;
			}
			
			if (!this.pause) {
			
				let curr_workout = this.get_curr_workout();
				let exercises = this.get_exercises();
				this.curr_exercise.remaining_time -= time_diff;
				
				// countdown
				let remain = Math.round (this.curr_exercise.remaining_time / 1000);
				if (remain <= curr_workout.settings.count_down && remain > 0) {
					//this.beep1.play()
					
					if (this.last_countdown > remain && remain > 0 && !this.reading) {
						this.readText (remain);
						this.last_countdown = remain;
					}
				}
				
				if (remain <= 0) {
					
					if (this.state == 'pre_delay') {
						this.curr_exercise.period = 'work';
						//this.beep2.play();
						this.readText (`go! ${exercises[this.curr_exercise.exercise].name}`);
						this.state = 'running';
						this.curr_exercise.remaining_time = this.get_work_period();
						this.update_progressbar ('exercise', this.curr_exercise.remaining_time);
						this.update_progressbar ( 'workout', this.getWorkoutDuration (curr_workout) );
						
						this.last_countdown = Infinity;
					}
					else if (this.curr_exercise.period == 'work' && curr_workout.exercises.length - 1 > this.curr_exercise.exercise) {
						this.curr_exercise.period = 'rest';
						this.last_countdown = Infinity;
						//this.beep2.play();
						
						this.readText ('Rest').then ( () => {
							let next_speak = () => this.readText (`${this.curr_exercise.exercise < curr_workout.exercises.length - 2 ? 'Next' : 'Last'} exercise: ${exercises[this.curr_exercise.exercise + 1].name}`);
							
							if ( this.get_rest_period (curr_workout,  curr_workout.exercises.length) > 1 && curr_workout.exercises.length - 1 > this.curr_exercise.exercise &&
								 Math.round (curr_workout.exercises.length / 2) - 1 == this.curr_exercise.exercise )
							{
								this.readText ('Half way there').then ( () => next_speak() );
							}
							else {
								next_speak();
							}
						});
						
						this.curr_exercise.remaining_time = this.get_rest_period();
						this.update_progressbar ('exercise', this.curr_exercise.remaining_time);
					}
					else { // rest
						this.curr_exercise.period = 'work';
						this.last_countdown = Infinity;
						
						if (curr_workout.exercises.length - 1 > this.curr_exercise.exercise) {
							this.curr_exercise.exercise++;
							//this.beep2.play();
							this.readText (`go! ${exercises[this.curr_exercise.exercise].name}`);
							this.curr_exercise.remaining_time = this.get_work_period();
							this.update_progressbar ('exercise', this.curr_exercise.remaining_time);
						}
						else {
							//this.beep2.play();
							this.readText ('Workout finished');
							this.state = 'finished';
							this.stop_animation ('exercise');
							this.stop_animation ('workout');
							curr_workout.completed = (curr_workout.completed ?? 0) + 1;
							this.store();
							
							finished = true;
							this.last_countdown = Infinity;
							this.nosleep.disable();
						}
					}
				}
			}
			
			if (!finished) {
				setTimeout ( () => { this.run(); }, 10 );
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
			
			return ( exercise.settings?.work_period ?? workout.settings.work_period ) * 1000;
		},
		get_rest_period: function (workout = null, exercise = null) {
			if (workout == null) {
				workout = this.get_curr_workout();
			}
			
			if (exercise == null)
			{
				exercise = this.curr_exercise.exercise;
			}
			
			return ( exercise.settings?.rest_period ?? workout.settings.rest_period ) * 1000;
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
			
			this.nosleep.enable();
			
			let start = () => {
				this.last_time = Date.now();		
				this.update_progressbar ('exercise', this.curr_exercise.remaining_time);
				this.run();
			};
			
			this.readText ('First exercise: ' + this.get_exercises()[this.curr_exercise.exercise].name).then ( () => {
				if (curr_workout.settings.pre_delay > 0) {
					this.readText (`Starting in ${curr_workout.settings.pre_delay} seconds${curr_workout.settings.pre_delay != 1 ? 's' : ''}`).then (start);
				}
				else {
					start();
				}
			});
			
			
		},
		pause: false,
		pause_workout: function() {
			this.pause = !this.pause;
			
			if (document.styleSheets[1].cssRules[0]) {
				document.styleSheets[1].cssRules[0].style.animationPlayState = this.pause ? 'paused' : 'running';
			}
			
			// catch pre_delay phase
			if (document.styleSheets[2].cssRules.length > 0) {
				document.styleSheets[2].cssRules[0].style.animationPlayState = this.pause ? 'paused' : 'running';
			}
			
			if (this.pause) {
				this.nosleep.disable();
			}
			else
			{
				this.nosleep.enable();
			}
		},
		is_running: function() {
			return ['pre_delay', 'running'].includes (this.state);
		},
		stop_workout: function() {
			if ( this.is_running() ) {
				this.quit = true;
			}
			
			this.nosleep.disable();
		},
		quit: false,
		quit_workout: function() {
			this.quit = true;
			this.nosleep.disable();
		},
		store: function() {
			localStorage.setItem ('workouts', JSON.stringify (this.workouts) );
			localStorage.setItem ('last_workout', this.curr_workout);
		},
		getWorkoutDuration: function (workout) {
			return workout.exercises.reduce ( (sum, x, i) => sum + this.get_work_period (workout, x) + ( i < workout.exercises.length - 1 ? this.get_rest_period (workout, x) : 0 ) , 0 );
		},
		update_progressbar: function (type, time) {
			if (type == 'exercise') {
				if (document.styleSheets[1].cssRules.length > 0) {
					this.stop_animation ('exercise');
				}
				
				document.styleSheets[1].addRule ('exercise_timer::before',`content: "";
					box-sizing: border-box;
					position: absolute;
					inset: 0px;
					border-radius: 50%;
					border: 1rem solid black;
					transform: rotate(45deg);
					animation: prixClipFix_exercise ${time / 1000}s linear 1;`
				);
			}
			else // workout
			{
				document.styleSheets[2].addRule ('workout_timer::before', `
					content: "";
					box-sizing: border-box;
					position: absolute;
					inset: 0px;
					border-radius: 50%;
					border: 1rem solid #616161;
					transform: rotate(45deg);
					animation: prixClipFix_workout ${time / 1000}s linear 1;
				`);
			}
		},
		stop_animation: function (type) {
			let style = document.styleSheets[type == 'exercise' ? 1 : 2];
			if (style.cssRules.length > 0) {
				style.removeRule (0);
			}
			
			for ( let anim of document.getAnimations() ) {
				if ( anim.animationName.includes (type) ) {
					anim.cancel();
				}
			}
			
			let element = document.getElementById (type + '_timer');
			if (element) {
				element.style.animation = 'none';
				element.offsetHeight; /* trigger reflow */
				element.style.animation = null; 
			}
		},
		secondsToTime: function(e) {
			const m = Math.floor(e % 3600 / 60).toString().padStart(2,'0'),
				  s = Math.floor(e % 60).toString().padStart(2,'0');	
			return m + ':' + s;
		},
		
		reading: false,
		readText: function (text, workout=null) {
			if (!this.reading) {
				this.reading = true;
				if (workout == null) {
					workout = this.get_curr_workout();
				}
				
				let voice = this.voices[this.get_voice (workout.settings.voice)];
				return Speakit.readText (text, voice.lang, voice.name).then ( () => { this.reading = false; } );
			}
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
	};
}
