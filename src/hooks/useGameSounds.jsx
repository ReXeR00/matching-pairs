import { useRef, useCallback } from "react";
import correctSnd from "../asssets/sounds/correct.mp3";
import wrongSnd from "../asssets/sounds/wrong.mp3";

/*
  useGameSounds:
  - playCorrect() -> gra dźwięk sukcesu
  - playWrong()   -> gra dźwięk błędu
  - setVolume(v)  -> ustawia volume 0..1
  - setMuted(b)   -> mute true/false
  - AudioElements -> <audio> które trzeba wyrenderować w JSX żeby refs działały
*/
export function useGameSounds() {
  const okRef = useRef(null);
  const badRef = useRef(null);

  const playCorrect = useCallback(() => {
    if (okRef.current) {
      okRef.current.currentTime = 0;
      okRef.current.play().catch(() => {});
    }
  }, []);

  const playWrong = useCallback(() => {
    if (badRef.current) {
      badRef.current.currentTime = 0;
      badRef.current.play().catch(() => {});
    }
  }, []);

  const setVolume = useCallback((v) => {
    if (okRef.current) okRef.current.volume = v;
    if (badRef.current) badRef.current.volume = v;
  }, []);

  const setMuted = useCallback((m) => {
    if (okRef.current) okRef.current.muted = m;
    if (badRef.current) badRef.current.muted = m;
  }, []);

  // to potem wstawiamy w JSX (np. na dole komponentu Game)
  const AudioElements = (
    <>
      <audio ref={okRef} src={correctSnd} preload="auto" />
      <audio ref={badRef} src={wrongSnd} preload="auto" />
    </>
  );

  return {
    playCorrect,
    playWrong,
    setVolume,
    setMuted,
    AudioElements,
  };
}
