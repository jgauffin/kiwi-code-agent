import { mkdtemp, mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'probe-'))
const root = join(dir, 'root')
await mkdir(root, { recursive: true })
const dest = join(root, 'summary.md')
const before = 'old '.repeat(100_000)
const after = 'new '.repeat(100_000)
await writeFile(dest, before, 'utf8')
const staging = join(dir, 'staging')
await mkdir(staging, { recursive: true })
const src = join(staging, 'summary.md')
await writeFile(src, after, 'utf8')

let running = true
let reads = 0
let open = 0
const reader = (async () => {
  while (running) {
    open++
    await readFile(dest, 'utf8')
    open--
    reads++
    await new Promise((r) => setTimeout(r, Number(process.argv[2] ?? 1)))
  }
})()

let attempts = 0
let last
const started = Date.now()
while (Date.now() - started < 3000) {
  attempts++
  try {
    await rename(src, dest)
    last = 'ok'
    break
  } catch (e) {
    last = `${e.code} openInFlight=${open}`
    await new Promise((r) => setTimeout(r, 10))
  }
}
running = false
await reader
console.log({ attempts, last, reads, ms: Date.now() - started })
await rm(dir, { recursive: true, force: true })
