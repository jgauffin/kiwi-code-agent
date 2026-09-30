import { stateOfBoard, type Task, type TaskBoard, type TasksState } from '../src/agent/phases/tasks-file'

/** An open task that delivers nothing yet; a test names only what its rule is about. */
export const task = (name: string, over: Partial<Task> = {}): Task => ({
  name,
  text: name.toLowerCase(),
  delivers: [],
  files: [],
  newFiles: [],
  foreignFiles: [],
  context: [],
  how: '',
  proves: [],
  note: '',
  built: '',
  state: 'open',
  removed: false,
  ...over,
})

export const board = (...tasks: Task[]): TaskBoard => ({ tasks, verification: [] })

export const tasksState = (...tasks: Task[]): TasksState => stateOfBoard(board(...tasks))
