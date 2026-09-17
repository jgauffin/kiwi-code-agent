---
spec: 457aea8f
---

# Tasks for Session transcript export

- **T1**: Define the normalised transcript event model — the shared representation of prompts, responses, tool calls, permission requests, and interruptions that is engine-agnostic and maps to the markdown sections in B3–B7 (covers B3, B4, B5, B6, B7, B8, I3).
- **T2**: Implement the Claude-engine transcript adapter that reads the per-phase transcript artefact from `.agent/runs/<id>/` and produces the normalised event stream (covers B8, T1 dependency).
- **T3**: Implement the Berget-engine transcript adapter that reads the own-loop event log and produces the same normalised event stream (covers B8, A7, T1 dependency).
- **T4**: Implement the markdown renderer that maps a normalised event stream to the output markdown, including the header block (B3), conversation turns (B4), tool-call blocks (B5), permission-request blocks (B6), and interruption markers (B7).
- **T5**: Add large-output truncation to the renderer with an explicit notice stating how much was omitted (covers E3, A8, I2).
- **T6**: Add partial-transcript labelling to the renderer for in-progress sessions (covers B9, E1, A6).
- **T7**: Implement the export trigger in the extension UI that: checks the session has at least one event (E4), resolves the run id (E5), invokes the correct adapter and renderer, writes the file, and notifies the user of the save location (covers B1, B10, B11, A1, E4, E5).
- **T8**: Verify that the run id written into the exported file matches the run id of the `.agent/runs/<id>/` directory for that session (covers B11, I1).
