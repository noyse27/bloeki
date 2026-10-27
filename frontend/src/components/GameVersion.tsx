import { GAME_VERSION } from '../buildInfo';

export function GameVersion() {
  return <div className="pb-build-version">Spielversion: {GAME_VERSION}</div>;
}
