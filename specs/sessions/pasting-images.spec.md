---
feature: Pasting images
status: verified
id: 9d4e2b71-6a3f-4c8e-b5d0-2f7a91c3e648
authored: planned
---

# Pasting images

## Goal
A user wants to show the model something that is easier seen than described: a screenshot of a broken layout, an error dialog, a diagram. They paste the image from the clipboard or drop an image file onto the prompt box, and the model sees it with the prompt, on either engine where the model accepts images. An image belongs to the prompt it was sent with, not to the session: the extension does not keep it, so a session never grows by the images it once carried.

## Attaching an image
The user copies or drags an image and puts it in the composer.
- **Paste attaches image**: pasting clipboard content that holds an image and no text into the composer attaches the image to the next prompt and inserts nothing into its text (docs/features/composer-input.md#Composer input)
  - **Text only**: the clipboard holds text only → it pastes as text, as before.
  - **Image with text**: the clipboard holds both an image and text, as office apps copy → the text is pasted and no image is attached.
  - **Several images**: the clipboard holds several images → each is attached.
- **Drop attaches image**: dropping an image file onto the composer attaches it as a pasted image is attached, and the file itself is left untouched (docs/features/composer-input.md#Composer input)
- **Thumbnails on the composer**: each attached image shows as a thumbnail on the composer until the prompt is sent, and each can be removed before sending.
- **Composer cleared on send**: once a prompt is sent the composer holds no images, so the next prompt carries only images attached after it.
  - **E4** [removed]: The composer is held by an unanswered question card or takes no input → pasting attaches nothing, as typing sends nothing.
- **Image-only prompt**: a prompt with images and no text can be sent, and the session's title and a paired phone's list show it by how many images it carried.
- **Every prompt box**: the first prompt typed on the new-session screen accepts pasted and dropped images as the composer of a running session does.

## The model seeing the image
- **Image content to the model**: each attached image reaches the model as image content alongside the prompt's text, on the Claude engine and on the own loop alike (docs/features/composer-input.md#Composer input)
- **Shrunk before sending**: an image whose longer edge is over 2000 px is scaled down to 2000 px, keeping its proportions, before it is sent.
  - **Unsupported format**: an image in a format other than PNG, JPEG, GIF or WebP → it is converted to PNG before it is sent.
- **Nothing kept by the extension**: the extension never writes an attached image to disk: not to the project, not to the session's scratch folder, not to the run log.

## In the transcript
- **Image count noted**: the user's message in the transcript notes how many images it carried.
- **Live thumbnails**: while the session's tab stays open, the user's message shows its images as thumbnails (docs/features/composer-input.md#Composer input)
  - **Replayed after reload**: the transcript is replayed after a window reload → the message shows the note and no images.

## When a turn with images fails
- **Failed turn with images**: when a turn whose prompt carried images fails, its prompt and the work done stay in the conversation as any failed turn's do, the error shown says how many images the prompt carried, and on the own loop the images are dropped from the conversation so the next prompt goes through without them.
- **Refused prompt left out** [removed]: a rejected prompt that carried images does not stay in the conversation, so the next prompt goes through without its images.
  - **E5** [removed]: The endpoint rejects the prompt for a reason unrelated to the images → the error is reported as any other, and the images stay.

## Later in the conversation
- **Resumed thread without images**: on the own loop, a resumed thread carries a note in place of each image the user's message had.
  - **Claude engine resume**: the thread runs on the Claude engine → it resumes with the images as the engine's own record of the thread kept them, and the extension leaves that record as it is.
- **Compaction drops images**: an own-loop conversation compacted past a message with images keeps the note and drops the images, the conversation's first message included even where its words are kept as they were.
