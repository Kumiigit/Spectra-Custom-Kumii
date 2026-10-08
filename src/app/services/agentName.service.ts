import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class AgentNameService {
  static normalizeAgentInternalName(agent: string): string {
    // Live feeds can use different casing (for example AggroBot vs Aggrobot).
    // Keep unknown names intact so newly added agents are not silently discarded.
    return Object.keys(AgentName).find((name) => name.toLowerCase() === agent.toLowerCase()) ?? agent;
  }

  static getAgentName(agent: string) {
    return AgentName[agent as keyof typeof AgentName];
  }

  static getAgentInternalName(agent: string) {
    const entry = Object.entries(AgentName).find(([, value]) => value === agent);
    return entry?.[0] || "";
  }
}

enum AgentName {
  "Aggrobot" = "Gekko",
  "BountyHunter" = "Fade",
  "Breach" = "Breach",
  "Cable" = "Deadlock",
  "Cashew" = "Tejo",
  "Clay" = "Raze",
  "Deadeye" = "Chamber",
  "Grenadier" = "KAY/O",
  "Guide" = "Skye",
  "Gumshoe" = "Cypher",
  "Hunter" = "Sova",
  "Iris" = "Miks",
  "Killjoy" = "Killjoy",
  "Mage" = "Harbor",
  "Nox" = "Vyse",
  "Pandemic" = "Viper",
  "Pine" = "Veto",
  "Phoenix" = "Phoenix",
  "Rift" = "Astra",
  "Sarge" = "Brimstone",
  "Sequoia" = "Iso",
  "Smonk" = "Clove",
  "Sprinter" = "Neon",
  "Stealth" = "Yoru",
  "Terra" = "Waylay",
  "Thorne" = "Sage",
  "Vampire" = "Reyna",
  "Wraith" = "Omen",
  "Wushu" = "Jett",
}
