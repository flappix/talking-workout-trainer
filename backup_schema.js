// JSON schema for validating restored workouts (see App.restore_backup)
function get_backup_schema() {
	return {
		definitions: {
			// number inputs (x-model) may store numbers as strings
			seconds: {
				anyOf: [
					{type: 'number', minimum: 0},
					{type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$'}
				]
			},
			exercise_period: {
				anyOf: [
					{$ref: '#/definitions/seconds'},
					{const: 'default'}
				]
			}
		},
		type: 'array',
		minItems: 1,
		items: {
			type: 'object',
			required: ['name', 'settings', 'exercises'],
			properties: {
				name: {type: 'string', minLength: 1},
				settings: {
					type: 'object',
					required: ['work_period', 'rest_period'],
					properties: {
						pre_delay: {$ref: '#/definitions/seconds'},
						count_down: {$ref: '#/definitions/seconds'},
						work_period: {$ref: '#/definitions/seconds'},
						rest_period: {$ref: '#/definitions/seconds'},
						voice: {type: 'string'}
					}
				},
				exercises: {
					type: 'array',
					minItems: 1,
					items: {
						type: 'object',
						required: ['name', 'work_period', 'rest_period'],
						properties: {
							name: {type: 'string'},
							work_period: {$ref: '#/definitions/exercise_period'},
							rest_period: {$ref: '#/definitions/exercise_period'}
						}
					}
				},
				completed: {type: 'integer', minimum: 0}
			}
		}
	};
}
