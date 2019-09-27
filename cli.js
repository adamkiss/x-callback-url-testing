const xcall = require('xcall')
const i = require('inquirer')
const {gray, white, yellow, bold} = require('kleur')
const qs = require('qs')

const quitCommands = ['.quit', '.exit', 'q', 'x', 'quit', 'exit']

let lastInput = ''
let activeClient = false
let activeClientScheme = false

const run = async lastInput => {
	while (!quitCommands.includes(lastInput)) {
		const {c} = await i.prompt({
			type: 'input', name: 'c', message: `Command? [${activeClientScheme || null}]`
		})
		lastInput = c
		if (quitCommands.includes(lastInput)) continue

		console.log(`${gray('> ')}${yellow(bold(lastInput))}`)

		if (lastInput[0] === '/'){
			// URL testing
			const [method, q] = lastInput.slice(1).split('?')
			const queryObject = qs.parse(q)

			try {
				const result = await activeClient.call(method, queryObject)
			} catch (e) {
				console.error(e)
			}
		} else {
			// Set app callback
			activeClientScheme = lastInput
			activeClient = xcall(activeClientScheme)
			console.log(`Client scheme set to ${lastInput}`)
			console.log()
		}
	}
}

run()
