---
feature: Permission decisions
status: verified
authored: planned
---

# Permission decisions

## Goal
A developer works with a session that reaches for the shell and the file tools constantly, and every prompt costs them a glance and a click. A call is worth asking about only for what it would actually do and where it would do it: a command that only prints what another handed it is harmless however the arguments reached it, a write through a redirect is a write at the file it lands in, and a command naming no file at all still happens in whatever directory the shell stands in. What the person wants back from a prompt differs with the place too: a call in their own repository is a matter for that workspace, while a folder of data on another drive is the same folder in every workspace they open, and being asked for it once per project is being asked three times too often. So a decision says what a call would do and where, the prompt says that in those terms and offers only the scopes the place warrants, and an answer given once covers the ground it was given for.

## What a call would do
Every simple command of a line is judged on its own, and the verdict says the kind and the place together.
- **A call says what it touches and where**: a decision names, for each thing the call would do, whether it reads a file, writes a file or runs a program of its own, and the path it would do it to, and a call that touches nothing at all runs unasked
  - **Copying and moving**: a command that copies or moves is judged as a read at the paths it takes from and a write at the paths it writes to, each against the rules for that kind
- **A write through a redirect is a write to its target**: output sent to a file is judged as a write at that file, and a line whose target cannot be told from the line itself is put to the person
- **Arguments from another command only bind what could reach a file**: a command handed its arguments by another command is asked about while any file those arguments could name would matter, and one that only prints, counts or tests what it is handed runs unasked however the arguments reached it
- **Running a program of its own is never covered by a place**: a call whose command word comes from another command's output, or that is handed a program to run, is put to the person every time and no kept answer covers it
- **A line passes only as a whole**: every simple command of the line has to be covered, so one command that is asked about asks for the line
- **A session's own instructions are its own ground**: reading a skill and the files it ships, a sub agent definition, the memory notes and the person's own rules file is never put to the person wherever those live, while a write there is a write like any other (docs/settings.md#Settings)

## Where the shell stands
A command that names no file still happens somewhere, and a line may move.
- **A command naming no path is judged where the shell stands**: a command that only inspects and names no path takes the directory the shell is in as its place, so it runs unasked while that directory is ground the person has granted (docs/settings.md#Settings)
  - **Standing in the project bounds files and nothing else**: a command that is not known to only inspect is asked about even when it names no path, since where it stands says nothing about the network or the person's own configuration
- **A change of directory carries to the rest of the line**: where a line changes directory, every command after it on that line is judged from the directory it moved to rather than from the project
  - **Moving somewhere not granted**: a line that moves to a directory no rule grants is asked about before any of it runs

## What the prompt offers
The person has to be able to settle a prompt at a glance, and to settle it once.
- **The prompt says the kind and the place**: a prompt leads with what the call would do and where wherever the call names a file or a command, and a call that names neither is led by the name of the tool and a plain line saying what it was asked to do
  - **Several things in one line**: a line that would do several things names each kind and place, and says which of them is the reason it is being asked
- **A write prompt shows its change**: a write is put to the person as the change it would make rather than as the arguments it was called with (specs/file-edit-diff.spec.md#Behaviour)
- **Keeping the answer is part of the answer**: the scopes an answer may be kept for stand beside Allow and Deny as part of the one answer, so granting and remembering is a single act rather than a second question
  - **This call alone is what is pre-selected**: every prompt offers an answer for this call alone, pre-selected, beside the scopes the answer may be kept for
- **Turning on Allow writes answers the prompts it covers**: switching the Allow writes setting on answers every write prompt already waiting that it covers, as though each had been allowed
- **Answered away from the desk**: a prompt can be allowed or denied from a paired phone with the same effect as at the desk (specs/remote-control.spec.md#Acting from the phone)

## How long an answer lasts
What the prompt offers to remember, where that answer is kept, and what no answer can grant.
- **Three scopes to keep an answer**: an answer may be kept for this session, for the workspace or for the person, and the prompt offers only the scopes the call's place warrants (docs/settings.md#Settings)
- **The person's scope is for ground outside the repositories**: keeping an answer for the person is offered only where the place lies outside the workspace's repositories, since a rule about a path inside one says nothing in any other workspace
  - **A sibling repository counts as outside**: a place in another repository on the machine may be kept for the person, which is how a second checkout is granted once rather than per workspace
- **A granted folder covers what lies beneath it**: a folder granted for reading or for writing covers the files beneath it at any depth, so a grant is given for a tree rather than folder by folder
- **A write kept for the person names one folder or one file**: a write outside the project may be kept as a grant for a named folder or a named file and never as a pattern standing for more
  - **Writes inside the project are the switch's**: a write to a file in the project is answered for that call alone, with the Allow writes setting as the only standing answer it leads to
- **Each scope is kept where its scope lives**: an answer kept for the workspace is kept with the workspace's own settings and one kept for the person with their own, so a grant one person gave never travels to the team with the source (docs/settings.md#Settings)
- **A denial is kept like a grant**: a denial may be kept for the session, the workspace or the person wherever an allow may, offered the same scopes in the same place on the prompt
- **A wider deny is not undone by a narrower allow**: a denial holds over every scope, so an answer kept for the session or the workspace cannot let through what a rule above it forbids
- **Some targets are always asked**: a write to a file that decides what runs without asking is put to the person whatever any kept answer or the Allow writes setting says (docs/settings.md#Settings)
  - **The person's rules are guarded like the workspace's**: a write to where the person's own permission rules are kept is always put to them, as a write to the workspace's settings is
- **Git writes can be refused outright**: while git writes are denied for the workspace, every git command that is not read-only is refused whatever any kept answer says (docs/settings.md#Settings)

## Open questions
- **Tooling granted once for every workspace**: whether a command that only inspects and names no path may be kept for the person even though it stands inside a repository, or whether such commands stay a matter for the workspace
