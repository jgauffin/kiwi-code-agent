---
feature: Finishing the build
status: draft
---

# Finishing the build

## Goal
A developer following a feature through the plan bar has to be able to trust what the steps say and to get the feature to its end. Today the Verify step is shown even when no test command applies to the feature, so a feature can show tests as passed when none ran. And a task its implementer blocked stays blocked: the build cannot get past it, and handing it back only repeats the block. This feature shows Verify only when it runs something, and makes its view show that run. A blocked task gets a second look once everything else is built, and a task still blocked after that waits for the developer, who can hand it back or accept it as it is.

## A feature with tests to run
- **Verify only when tests run**: the plan bar shows the Verify step only when a configured test command applies to a file the feature's tasks name, and otherwise the feature goes from Implement straight to Cleanup (docs/intent/agent.md#Stages)
  - **Before any file is named**: while no task names a file yet, Verify is shown when any test command is configured at all.
- **Nothing run is no pass**: a feature whose tasks match no test command never shows its tests as passed; the board says that no tests ran.
- **The run on view**: the Verify step's view always shows the test run, with each command, where it ran, whether it passed and the output of each failure, followed by the conversation of the run fixing it (docs/intent/agent.md#Verification)
  - **Before the first run**: before any run, the view lists the commands that will run.

## A task that stays blocked
- **Another look at the end**: once nothing is left to build but blocked tasks, each blocked task goes back once to the run that blocked it, in that run's own conversation, told that every other task is finished (docs/intent/agent.md#Phase 3: Implement)
  - **Its run is gone**: a blocked task whose run no longer exists is taken up by a new run for that task, told why it was blocked.
- **Still blocked waits for the developer**: a task still blocked after that look is not handed back again by itself, and the plan bar points the developer to it.
- **Hand back**: the developer can hand a blocked task back to the run that blocked it, which carries on in the same conversation.
  - **Answer in the chat**: a message the developer writes to that run also hands the task back.
- **Accept as is**: the developer can accept a blocked task, and the board records it as accepted by the developer, with the reason it was blocked, never as tested.
  - **Accepted is finished**: once every task is tested or accepted, the feature moves on to Verify, or past it when Verify is not shown.
  - **Still unproven**: a rule an accepted task delivers without a test is still shown as having no test.

## Open questions
- **Status without tests**: should a feature whose tasks match no test command be recorded as verified, or stay implemented?
- **Dropping a task**: should the developer be able to drop a blocked task, which would mean taking its rules out of the spec?
