---
feature: Directory permission
status: verified
authored: planned
---

# Directory permission

## Goal
A session that reads or writes outside the project is asking to work somewhere the person never granted, and what the person wants to grant is a place and what may be done there, not the command that happened to ask. The place asked for is rarely the place they would choose to keep: a session reaching into one crate of a package cache will reach into its neighbours next, while the person's home folder is far more than they would hand over for it. So every read and every write outside the project is asked about as the directory it reaches and whether it would read or write there, the person picks how far up that grant reaches, and a grant then answers for every command and file tool doing that kind of thing beneath it, without ever becoming a grant to go anywhere.

## Asked about as a place
A call reads or writes outside the project somewhere no rule grants.
- **The prompt names the directory rather than the command**: a read or a write outside the project, whether by a shell command or by a file tool, is asked about as the directory it reaches, and no prompt ever offers to keep an answer for the command as such (specs/permission-decisions.spec.md#What a call would do)
  - **Running a program is not a place**: a call that runs a program of its own is asked about as it was before, with no directory to keep (specs/permission-decisions.spec.md#What a call would do)
- **The prompt says read or write**: the prompt says whether the call would read in the directory or write to it, and a call that would read and write the same place is asked about as a write
- **The directory is shown whole**: the prompt shows the full path of the directory, read from where the shell stands at that point in the line, so a relative path names the absolute place it reaches
  - **Home folder shorthand**: a path starting at the person's home folder is read as the home folder it stands for
  - **A file names its folder**: a read or a write of a file is asked about as the directory that holds it
- **A target that names no place is asked every time**: A change into a directory that depends on a variable, on another command's output, or on an earlier change of directory in the line that may not have run offers only this call, with nothing to keep.
  - **Any uncertain path**: a read or a write whose path depends on any of those offers only this call too, with nothing to keep
  - **A wildcard in the path**: a path with a wildcard names the directories above the first wildcard, and only those are offered to keep
- **One prompt per missing grant**: a line that needs more than one grant it does not have asks about each directory and kind in turn, and denying any one of them refuses the whole line
- **A write prompt still shows its change**: a write outside the project is put to the person as the change it would make, with the choice of place to keep beside it (specs/permission-decisions.spec.md#What the prompt offers)

## Choosing how far a grant reaches
The person answers with a depth as well as a yes or no.
- **Every directory above it can be chosen**: the prompt offers the directory itself and each directory above it, up to but not including the root of its drive, as the place to keep the answer for
  - **Never the home folder**: the person's home folder and every directory holding it are never offered, so the climb under home stops one level below it, and a read or write directly in the home folder keeps nothing beyond, for a write, the file itself
  - **The directory itself is pre-selected**: until the person picks another, the place kept is the deepest one offered
- **A write may be kept for its file**: a write prompt also offers the file itself, ahead of the directory holding it, as the place to keep the answer for (specs/permission-decisions.spec.md#How long an answer lasts)
- **Allow and deny take the chosen place**: keeping an allow or a deny, for the session or for the person, keeps it for the place chosen at that moment and for the kind the prompt asked about (specs/permission-decisions.spec.md#How long an answer lasts)
- **Only the scopes outside ground warrants**: a directory grant is offered for this call, for the session and for the person, never for the workspace (specs/permission-decisions.spec.md#How long an answer lasts)
- **The answer reads back the place**: once answered, the prompt says which directory or file was allowed or denied, for reading or for writing, and for how long

## What a kept directory covers
- **A kept directory covers what lies beneath it**: a directory kept as allowed for reading lets any shell command or file tool read in it or any directory below it unasked, and one kept for writing does the same for writes, a wildcard path among them when the part above the wildcard lies beneath it (specs/permission-decisions.spec.md#How long an answer lasts)
  - **A sibling is not covered**: a directory beside the kept one, or above it, is still asked about
- **Standing there is reading there**: A directory the session may change into is one it may read unasked, whether it reads through a shell command or through the file-reading tools. (specs/permission-decisions.spec.md#A granted folder covers what lies beneath it)
  - **A change of directory is a read**: a change of directory is asked about and kept as a read of the directory it lands in
- **A write grant allows reading**: a directory or file kept as allowed for writing may also be read unasked
- **A kept denial refuses the same tree**: a directory kept as denied refuses the kind it was denied for in it or any directory below it, whatever an allow kept in a narrower scope says (specs/permission-decisions.spec.md#A wider deny is not undone by a narrower allow)
  - **A read denial refuses writes too**: a directory denied for reading refuses writes there as well, while one denied only for writing may still be read
- **Kept changes of directory carry over**: a directory kept as allowed or denied for changing into before this change stands as the same answer for reading
