// Глобальные моки для таймеров
jest.useFakeTimers()

// Мок для console.log и console.error
global.console = {
	log: jest.fn(),
	error: jest.fn(),
	warn: jest.fn(),
	info: jest.fn(),
	debug: jest.fn(),
}

// Мок для process.env
process.env = {
	...process.env,
	NODE_ENV: 'test',
}
