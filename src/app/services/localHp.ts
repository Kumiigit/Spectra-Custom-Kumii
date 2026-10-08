import { IMatchData } from './Types';

export interface LocalHpReading { groupCode: string; playerName: string; hp: number; updatedAt: number; roundNumber?: number; }
export const LOCAL_HP_TTL_MS = 5000;

export function applyLocalHp(match: IMatchData, reading: LocalHpReading | LocalHpReading[] | null, group: string, now = Date.now()): IMatchData {
  if(Array.isArray(reading)) return reading.slice(0,100).reduce((result,item)=>applyLocalHp(result,item,group,now),match);
  if (!reading || typeof reading.playerName !== 'string' || reading.groupCode !== group ||
      (reading.roundNumber!==undefined&&reading.roundNumber!==match.roundNumber) ||
      !Number.isInteger(reading.hp) || reading.hp < 0 || reading.hp > 100 ||
      !Number.isFinite(reading.updatedAt) || now - reading.updatedAt >= LOCAL_HP_TTL_MS || reading.updatedAt > now + 1000) return match;
  const name = reading.playerName.toLowerCase();
  const matches = match.teams.flatMap(t => t.players).filter(p =>
    p.name?.toLowerCase() === name || p.fullName?.toLowerCase() === name);
  // Never guess with duplicate names, override a dead player, or alter Spectra's death state.
  if (matches.length !== 1 || matches[0].isAlive !== true) return match;
  const target = matches[0];
  return {...match, teams:match.teams.map(t => ({...t,players:t.players.map(p => p === target ?
    {...p,health:reading.hp,auxiliaryAvailable:{...p.auxiliaryAvailable,health:true}} : p)}))};
}
