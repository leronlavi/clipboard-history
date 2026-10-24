// Watches the macOS clipboard and prints one JSON line (to stderr, as JXA's
// console.log does) per new copy: text, an image saved as PNG, or a skip for
// what a password manager marks concealed. Run: osascript -l JavaScript <this> <dir>
ObjC.import('AppKit')
ObjC.import('Foundation')

function run(argv) {
  const dir = argv[0]
  const MAX_CHARS = 20000
  const pb = $.NSPasteboard.generalPasteboard
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), $())
  const emit = o => console.log(JSON.stringify(o))
  let last = pb.changeCount
  emit({ kind: 'ready' })

  while (true) {
    delay(0.5)
    const count = pb.changeCount
    if (count === last) continue
    last = count

    const types = ObjC.deepUnwrap(pb.types) || []
    if (types.includes('org.nspasteboard.ConcealedType') || types.includes('org.nspasteboard.TransientType')) {
      emit({ kind: 'skip', reason: 'concealed' })
      continue
    }

    // Text wins over an image: apps that copy text often add a picture of it.
    const text = pb.stringForType('public.utf8-plain-text')
    if (text && !text.isNil()) {
      emit({ kind: 'text', text: text.js.slice(0, MAX_CHARS) })
      continue
    }

    let data = pb.dataForType('public.png')
    if (!data || data.isNil()) {
      const tiff = pb.dataForType('public.tiff')
      if (tiff && !tiff.isNil()) {
        const rep = $.NSBitmapImageRep.imageRepWithData(tiff)
        if (rep && !rep.isNil()) data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
      }
    }
    if (data && !data.isNil()) {
      const rep = $.NSBitmapImageRep.imageRepWithData(data)
      const id = String(Date.now())
      const path = dir + '/' + id + '.png'
      data.writeToFileAtomically(path, true)
      const front = $.NSWorkspace.sharedWorkspace.frontmostApplication
      const app = front && !front.isNil() ? front.localizedName.js : ''
      emit({ kind: 'image', id, path, app, width: rep.pixelsWide, height: rep.pixelsHigh, bytes: data.length })
    }
  }
}
