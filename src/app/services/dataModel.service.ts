import { computed, inject, Injectable, signal, OnDestroy } from "@angular/core";
import { SocketService } from "./SocketService";
import { IMapbanSessionData, IMatchData, ISponsorInfo, ITournamentInfo } from "./Types";
import { ActivatedRoute } from "@angular/router";
import { Config } from "../shared/config";
import { isEqual } from "lodash";
import { i18nHelper } from "./i18nHelper";
import { TranslateService } from "@ngx-translate/core";
import { AgentNameService } from "./agentName.service";
import { applyLocalHp, LocalHpReading } from "./localHp";

@Injectable({
  providedIn: "root",
})
export class DataModelService implements OnDestroy {
  protected route = inject(ActivatedRoute);
  protected config = inject(Config);
  protected translate = inject(TranslateService);
  private serverMatch: IMatchData | null = null;
  private localHp: LocalHpReading | LocalHpReading[] | null = null;
  private hpTimer?: ReturnType<typeof setTimeout>;
  private hpEnabled = false;
  private destroyed = false;
  private hpStateSignature = '';
  private hpStateQueue: Promise<boolean> = Promise.resolve(false);
  private readonly hpPreview = ['127.0.0.1','localhost'].includes(location.hostname)&&new URLSearchParams(location.search).get('hpPreview')==='1';

  private async loadHpPreview() {
    const response=await fetch('/hp-reader/preview-roster.json');
    const roster: {name:string;agentInternal:string}[]=await response.json();
    const match: IMatchData=structuredClone(initialMatchData);
    Object.assign(match,{groupCode:'HP-PREVIEW',isRunning:true,roundNumber:1,roundPhase:'combat'});
    for(const [side,team] of match.teams.entries()){
      Object.assign(team,{teamName:side?'RED TEST':'GREEN TEST',teamTricode:side?'RED':'GRN',teamUrl:'assets/misc/icon.webp',roundsWon:side?8:5,isAttacking:side===0});
      team.players=roster.slice(side*5,side*5+5).map((p,i)=>({...p,fullName:p.name+'#DEMO',playerId:side*5+i,
        isAlive:true,locked:true,isObserved:false,armorName:'',money:3500,moneySpent:0,highestWeapon:'Vandal',isCaptain:false,
        currUltPoints:0,maxUltPoints:8,ultReady:false,hasSpike:false,scoreboardAvailable:true,
        auxiliaryAvailable:{health:true,abilities:false,scoreboard:true},kills:0,deaths:0,assists:0,killsThisRound:0,
        health:100,deathsThisRound:0,killedPlayerNames:[],abilities:{grenade:0,ability1:0,ability2:0},iconNameSuffix:''}));
    }
    this.onMatchUpdate(match);
  }

  private publishHpState() {
    if(!this.hpEnabled||!this.serverMatch)return;
    const match=this.serverMatch;
    const state={groupCode:this.groupCode(),roundNumber:match.roundNumber,roundPhase:match.roundPhase,map:match.map,isRunning:match.isRunning,
      players:match.teams.flatMap(t=>t.players).map(p=>({name:p.name,fullName:p.fullName||'',isAlive:p.isAlive===true}))};
    const signature=JSON.stringify(state);
    if(signature===this.hpStateSignature)return;
    this.hpStateSignature=signature;this.localHp=null;
    // Preserve death -> alive transitions even when they arrive between polls.
    this.hpStateQueue=this.hpStateQueue.then(async()=>{
      try {const response=await fetch('http://127.0.0.1:5210/hp/state',{method:'POST',headers:{'Content-Type':'application/json'},body:signature,signal:AbortSignal.timeout(900)});return response.ok;}
      catch {return false;}
    });
  }

  private async pollLocalHp() {
    try {
      this.publishHpState();
      const signature=this.hpStateSignature;
      if(!await this.hpStateQueue){this.hpStateSignature='';throw Error('HP lifecycle unavailable');}
      const response = await fetch('http://127.0.0.1:5210/hp/all', {cache:'no-store', signal:AbortSignal.timeout(900)});
      // A failed poll is not an instruction to restore the server's default
      // health. Keep the last sample; applyLocalHp enforces its original age.
      if (response.ok) {const readings=await response.json();if(signature===this.hpStateSignature)this.localHp=readings;}
    } catch { /* Retain the last sample through brief delivery interruptions. */ }
    if (this.destroyed) return;
    if (this.serverMatch) {
      const next = applyLocalHp(this.serverMatch, this.hpEnabled ? this.localHp : null, this.groupCode());
      if (!isEqual(next, this.match())) this.match.set(next);
    }
    if (this.hpEnabled) this.hpTimer = setTimeout(() => this.pollLocalHp(), 200);
  }

  ngOnDestroy() {
    this.destroyed = true;
    clearTimeout(this.hpTimer);
  }

  constructor() {
    this.route.queryParams.subscribe((params) => {
      this.groupCode.set(this.hpPreview?'HP-PREVIEW':((params["groupCode"] as string) || "").toUpperCase());
      this.sessionId.set(params["sessionId"] || "");
      const paramLang = params["lang"]?.toLowerCase() || "en";
      console.log("Setting language to", paramLang);
      this.language.set(i18nHelper.resolveLanguageAlias(paramLang));
      this.translate.use(this.language());
      this.hideAuxiliary.set(params["hideAuxiliary"] === "true");
      this.hideAuxiliaryText.set(params["hideAuxiliaryText"] === "true");
      const enabled = params['hpReader'] === '1' && ['127.0.0.1','localhost'].includes(location.hostname);
      if (enabled && !this.hpEnabled) { this.hpEnabled = true; void this.pollLocalHp(); }
      else if (!enabled && this.hpEnabled) {
        this.hpEnabled = false; this.localHp = null; clearTimeout(this.hpTimer);
        if (this.serverMatch) this.match.set(this.serverMatch);
      }
    });

    if (this.route.firstChild && this.route.firstChild.firstChild) {
      this.route.firstChild!.firstChild!.data.subscribe((data) => {
        this.minimalMode.set(data["minimal"]);
      });
    }

    if(this.hpPreview){void this.loadHpPreview();return;}
    if (!this.config.serverEndpoint || this.config.serverEndpoint.length === 0) {
      console.error("No server endpoint configured, cannot connect to match data");
      return;
    }

    if (!this.groupCode() || this.groupCode().length === 0) {
      console.error("No group code provided, cannot connect to match data");
    } else {
      SocketService.getInstance().subscribeMatch(this.onMatchUpdate.bind(this));
      SocketService.getInstance().connectMatch(this.config.serverEndpoint, this.groupCode());
    }

    if (this.sessionId() && this.sessionId().length > 0) {
      if (!this.config.mapbanEndpoint || this.config.mapbanEndpoint.length === 0) {
        console.error("No mapban endpoint configured, cannot connect to mapban data");
      } else {
        SocketService.getInstance().subscribeMapban(this.onMapbanUpdate.bind(this));
        SocketService.getInstance().connectMapban(this.config.mapbanEndpoint, {
          sessionId: this.sessionId(),
        });
      }
    }
  }

  private onMatchUpdate(data: any) {
    for (const team of data?.teams ?? []) {
      for (const player of team.players ?? []) {
        if (typeof player.agentInternal === "string") {
          player.agentInternal = AgentNameService.normalizeAgentInternalName(player.agentInternal);
        }
      }
    }
    // Construct map for name overrides if it's a string (from JSON).
    // The server keeps it as JSON to avoid having to (de)-serialize multiple times.
    const tempOverrides = data?.tools?.nameOverrides?.overrides || null;
    if (typeof tempOverrides === "string") {
      data.tools.nameOverrides.overrides = this.jsonToMap(tempOverrides);
    }
    this.serverMatch = data;
    this.publishHpState();
    this.match.set(applyLocalHp(data, this.hpEnabled ? this.localHp : null, this.groupCode()));
  }

  private jsonToMap(json: string): Map<string, string> {
    try {
      const obj = JSON.parse(json);
      if (Array.isArray(obj)) {
        return new Map(obj);
      } else {
        throw new Error("Invalid JSON format for Map");
      }
    } catch (error) {
      console.error("Failed to parse JSON to Map:", error);
      return new Map();
    }
  }

  public numberFormatter = computed<Intl.NumberFormat>(() => {
    try {
      return new Intl.NumberFormat([this.language(), "en"], { useGrouping: true });
    } catch (error) {
      console.warn(`Invalid locale "${this.language()}", falling back to "en"`, error);
      return new Intl.NumberFormat("en", { useGrouping: true });
    }
  });

  private onMapbanUpdate(data: any) {
    this.mapban.set(data);
  }

  public groupCode = signal("");
  public sessionId = signal("");
  public language = signal("en");
  public minimalMode = signal(false);
  public hideAuxiliary = signal(false);
  public hideAuxiliaryText = signal(false);

  private _tournamentInfoOverride = signal<ITournamentInfo | null>(null);
  private _sponsorInfoOverride = signal<ISponsorInfo | null>(null);

  public setTournamentInfo(info: ITournamentInfo) {
    this._tournamentInfoOverride.set(info);
  }

  public setSponsorInfo(info: ISponsorInfo) {
    this._sponsorInfoOverride.set(info);
  }

  public match = signal<IMatchData>(initialMatchData, { equal: () => false });
  public teams = computed(() => this.match().teams, { equal: () => false });
  public timeoutState = computed(() => this.match().timeoutState, {
    equal: () => false,
  });
  public timeoutCounter = computed(() => this.match().tools.timeoutCounter, {
    equal: isEqual,
  });
  public timeoutCancellationGracePeriod = computed(
    () => this.match().tools.timeoutCancellationGracePeriod,
  );

  public spikeState = computed(() => this.match().spikeState, {
    equal: isEqual,
  });
  public seriesInfo = computed(() => this.match().tools.seriesInfo);
  public seedingInfo = computed(() => this.match().tools.seedingInfo);
  public sponsorInfo = computed(
    () => this._sponsorInfoOverride() ?? this.match().tools.sponsorInfo,
  );
  public watermarkInfo = computed(() => this.match().tools.watermarkInfo);
  public tournamentInfo = computed(
    () => this._tournamentInfoOverride() ?? this.match().tools.tournamentInfo,
  );
  public toastInfo = computed(() => this.match().toastInfo, { equal: () => false });
  public playercamsInfo = computed(() => this.match().tools.playercamsInfo, {
    equal: () => false,
  });
  public readonly roundWinBox = computed(() => this.match().tools.roundWinBox);

  public mapban = signal<IMapbanSessionData>(initialMapbanData, { equal: () => false });
}

//setting up with empty match state so certain ui parts dont complain
export const initialMatchData: IMatchData = {
  groupCode: "A",
  isRanked: false,
  isRunning: true,
  roundNumber: 0,
  roundPhase: "LOBBY",
  agentSelectStartTime: 0,
  teams: [
    {
      teamName: "",
      teamUrl: "",
      teamTricode: "",
      spentThisRound: 0,
      isAttacking: false,
      roundsWon: 0,
      players: [],
    },
    {
      teamName: "",
      teamUrl: "",
      teamTricode: "",
      spentThisRound: 0,
      isAttacking: false,
      roundsWon: 0,
      players: [],
    },
  ],
  spikeState: { planted: false, defused: false, detonated: false },
  map: "Ascent",
  tools: {
    seriesInfo: {
      needed: 1,
      wonLeft: 0,
      wonRight: 0,
      mapInfo: [],
    },
    seedingInfo: {
      left: "",
      right: "",
    },
    tournamentInfo: {
      name: "",
      logoUrl: "",
      backdropUrl: "",
    },
    timeoutDuration: 60,
    timeoutCancellationGracePeriod: 10,
    timeoutCounter: {
      max: 2,
      left: 2,
      right: 2,
    },
    sponsorInfo: {
      enabled: false,
      duration: 5000,
      sponsors: [],
    },
    // Disabling the watermark/setting a custom text without Spectra Plus is against the License terms and strictly forbidden
    watermarkInfo: {
      spectraWatermark: true,
      customTextEnabled: false,
      customText: "",
    },
    playercamsInfo: { enable: false },
    nameOverrides: { overrides: [] },
    roundWinBox: {
      type: "disabled",
      sponsors: [],
    },
    agentSelectActive: false,
  },
  toastInfo: {
    active: false,
    duration: 10000,
    title: "",
    message: "",
    eventLogoEnabled: true,
    selectedTeam: "none",
  },
  timeoutState: {
    techPause: false,
    leftTeam: false,
    rightTeam: false,
    timeRemaining: 0,
  },
  showAliveKDA: false,
  switchRound: 12,
  firstOtRound: 25,
  attackersWon: false,
};

const initialMapbanData: IMapbanSessionData = {
  sessionIdentifier: "",
  organizationName: "",
  isSupporter: false,
  teams: [],
  format: undefined,
  availableMaps: [],
  selectedMaps: [],
  stage: "ban",
  actingTeamCode: "",
  actingTeam: 0,
};
