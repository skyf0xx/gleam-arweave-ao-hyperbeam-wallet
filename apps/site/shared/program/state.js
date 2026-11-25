// State the audio modules share. One object, because an ES module can't
// reassign another module's binding.

export var S = {
  soundOn: false, // off at the start of every visit; see sound.js
  audio: null,
  // Where a voice's notes go: the master, or a panner while play() places a
  // note in the stereo field. Set and cleared around one synchronous call.
  route: null,
  padWanted: false,
};
