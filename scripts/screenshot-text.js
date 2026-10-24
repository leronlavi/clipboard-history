// Prints the text macOS's Vision framework reads in a PNG, one line per
// region, top of the picture first. Run: osascript -l JavaScript <this> <png>
ObjC.import('Foundation')
ObjC.import('Vision')

function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0])
  const request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = $.VNRequestTextRecognitionLevelFast
  request.usesLanguageCorrection = false
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}))
  if (!handler.performRequestsError($([request]), $())) return ''
  const results = request.results
  const lines = []
  for (let i = 0; i < results.count && lines.length < 60; i++) {
    const best = results.objectAtIndex(i).topCandidates(1)
    if (best.count > 0) lines.push(best.objectAtIndex(0).string.js)
  }
  return lines.join('\n')
}
