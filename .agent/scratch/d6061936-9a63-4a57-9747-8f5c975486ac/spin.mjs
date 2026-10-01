// Burns a core for the given seconds, to starve the test run on purpose.
const until = Date.now() + Number(process.argv[2] ?? 30) * 1000
while (Date.now() < until) Math.sqrt(Math.random())
