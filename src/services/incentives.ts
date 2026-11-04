import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  dateKeyGuayaquil,
  nextSundayResetLabel,
  weekKeyGuayaquil,
} from '../utils/time';

export type IncentivesState = {
  points: number;
  totalDistanceM: number;
  walksCompleted: number;
  level: number;
  achievements: string[];
  displayName: string;
  /** Pasos acumulados esta semana (ranking) */
  weeklySteps: number;
  weeklyDistanceM: number;
  weekKey: string;
  /** Facultades visitadas esta semana */
  weeklyDestinations: string[];
  weeklyWalks: number;
  dailyRutaUses: number;
  dailyKey: string;
  streak: number;
  lastStreakDate: string | null;
  /** ids de misiones completadas hoy / semana */
  completedDailyIds: string[];
  completedWeeklyIds: string[];
  dailyBonusClaimed: boolean;
  weeklyBonusClaimed: boolean;
  lastWeeklyRewardNote: string | null;
};

export type Mission = {
  id: string;
  title: string;
  description: string;
  type: 'daily' | 'weekly';
  target: number;
  unit: 'count' | 'meters' | 'steps' | 'destinations' | 'streak';
  reward: number;
  progress: number;
  done: boolean;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  steps: number;
  isYou: boolean;
};

const KEY = 'campus_incentives_v2';

const defaultState = (): IncentivesState => ({
  points: 0,
  totalDistanceM: 0,
  walksCompleted: 0,
  level: 1,
  achievements: [],
  displayName: 'Tú (ESPOL)',
  weeklySteps: 0,
  weeklyDistanceM: 0,
  weekKey: weekKeyGuayaquil(),
  weeklyDestinations: [],
  weeklyWalks: 0,
  dailyRutaUses: 0,
  dailyKey: dateKeyGuayaquil(),
  streak: 0,
  lastStreakDate: null,
  completedDailyIds: [],
  completedWeeklyIds: [],
  dailyBonusClaimed: false,
  weeklyBonusClaimed: false,
  lastWeeklyRewardNote: null,
});

let cache: IncentivesState | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeIncentives(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function levelFromPoints(points: number) {
  return Math.max(1, Math.floor(points / 120) + 1);
}

function unlockAchievements(state: IncentivesState): string[] {
  const set = new Set(state.achievements);
  if (state.walksCompleted >= 1) set.add('Primera caminata');
  if (state.totalDistanceM >= 1000) set.add('1 km activo');
  if (state.totalDistanceM >= 5000) set.add('5 km campus');
  if (state.points >= 300) set.add('Eco Walker');
  if (state.level >= 3) set.add('Nivel 3');
  if (state.streak >= 3) set.add('Racha x3');
  if (state.streak >= 7) set.add('Racha x7');
  return [...set];
}

async function loadRaw(): Promise<IncentivesState> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  cache = raw
    ? { ...defaultState(), ...(JSON.parse(raw) as IncentivesState) }
    : defaultState();
  // Nota creada por la versión con el bug de fechas ("Semana NaN-WNaN…"): se descarta.
  if (cache.lastWeeklyRewardNote?.includes('NaN')) cache.lastWeeklyRewardNote = null;
  return cache;
}

async function save(next: IncentivesState) {
  next.level = levelFromPoints(next.points);
  next.achievements = unlockAchievements(next);
  cache = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  emit();
}

/** Premios por posición al cerrar la semana (domingo 23:59). */
export function rankingBracketReward(rank: number): number {
  if (rank === 1) return 500;
  if (rank <= 5) return 300;
  if (rank <= 10) return 180;
  if (rank <= 20) return 100;
  if (rank <= 40) return 60;
  if (rank <= 80) return 30;
  return 15;
}

const BOT_NAMES = [
  'Ana FIEC',
  'Luis FCNM',
  'María FCSH',
  'Pedro FIMCP',
  'Sofía FADCOM',
  'Diego FICT',
  'Valentina FCV',
  'Andrés CTI',
  'Camila Biblioteca',
  'José Rectorado',
  'Lucía FIMCM',
  'Mateo UBP',
  'Paula Admisiones',
  'Kevin Residencias',
  'Nicole FIEC',
  'Bryan FCNM',
  'Andrea FCSH',
  'Carlos FIMCP',
  'Elena FADCOM',
  'Gabriel FICT',
  'Isabella FCV',
  'Jorge CTI',
  'Karen Biblioteca',
  'Leo FIMCM',
];

function botSteps(seed: string, weekKey: string, youSteps: number): number {
  let h = 0;
  const s = seed + weekKey;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const base = 1200 + (h % 18000);
  // keep competition near user
  const jitter = (h % 900) - 450;
  return Math.max(200, Math.round(base * 0.35 + youSteps * 0.55 + jitter));
}

export function buildLeaderboard(state: IncentivesState): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [
    {
      id: 'you',
      name: state.displayName,
      steps: state.weeklySteps,
      isYou: true,
    },
    ...BOT_NAMES.map((name, i) => ({
      id: `bot-${i}`,
      name,
      steps: botSteps(name, state.weekKey, state.weeklySteps),
      isYou: false,
    })),
  ];
  return entries.sort((a, b) => b.steps - a.steps || (a.isYou ? -1 : 1));
}

export function yourRank(state: IncentivesState): number {
  const board = buildLeaderboard(state);
  return board.findIndex((e) => e.isYou) + 1;
}

function dailyDefs(): Omit<Mission, 'progress' | 'done'>[] {
  return [
    {
      id: 'd-ruta',
      title: 'Explorador del día',
      description: 'Usa Ruta Inteligente al menos 1 vez.',
      type: 'daily',
      target: 1,
      unit: 'count',
      reward: 25,
    },
    {
      id: 'd-walk',
      title: 'Una caminata',
      description: 'Completa 1 navegación a pie hacia una facultad.',
      type: 'daily',
      target: 1,
      unit: 'count',
      reward: 35,
    },
    {
      id: 'd-meters',
      title: '500 metros activos',
      description: 'Recorre 500 m validados con la guía del campus.',
      type: 'daily',
      target: 500,
      unit: 'meters',
      reward: 40,
    },
    {
      id: 'd-steps',
      title: '800 pasos campus',
      description: 'Acumula 800 pasos en rutas del día.',
      type: 'daily',
      target: 800,
      unit: 'steps',
      reward: 30,
    },
  ];
}

function weeklyDefs(): Omit<Mission, 'progress' | 'done'>[] {
  return [
    {
      id: 'w-walks',
      title: 'Semana caminante',
      description: 'Completa 5 caminatas con Ruta Inteligente.',
      type: 'weekly',
      target: 5,
      unit: 'count',
      reward: 120,
    },
    {
      id: 'w-km',
      title: '5 km por el campus',
      description: 'Acumula 5 km caminados esta semana.',
      type: 'weekly',
      target: 5000,
      unit: 'meters',
      reward: 150,
    },
    {
      id: 'w-faculties',
      title: 'Tour de facultades',
      description: 'Llega a 3 facultades distintas esta semana.',
      type: 'weekly',
      target: 3,
      unit: 'destinations',
      reward: 140,
    },
    {
      id: 'w-steps',
      title: '10.000 pasos semanales',
      description: 'Suma 10.000 pasos en el ranking semanal.',
      type: 'weekly',
      target: 10000,
      unit: 'steps',
      reward: 130,
    },
  ];
}

function progressFor(
  def: Omit<Mission, 'progress' | 'done'>,
  state: IncentivesState,
  dailyMeters: number,
  dailySteps: number,
  dailyWalks: number
): number {
  if (def.type === 'daily') {
    if (def.id === 'd-ruta') return Math.min(state.dailyRutaUses, def.target);
    if (def.id === 'd-walk') return Math.min(dailyWalks, def.target);
    if (def.id === 'd-meters') return Math.min(dailyMeters, def.target);
    if (def.id === 'd-steps') return Math.min(dailySteps, def.target);
  } else {
    if (def.id === 'w-walks') return Math.min(state.weeklyWalks, def.target);
    if (def.id === 'w-km') return Math.min(state.weeklyDistanceM, def.target);
    if (def.id === 'w-faculties')
      return Math.min(state.weeklyDestinations.length, def.target);
    if (def.id === 'w-steps') return Math.min(state.weeklySteps, def.target);
  }
  return 0;
}

const DAILY_EXTRA_KEY = 'campus_daily_extra_v1';

type DailyExtra = {
  date: string;
  meters: number;
  steps: number;
  walks: number;
};

async function loadDailyExtra(): Promise<DailyExtra> {
  const today = dateKeyGuayaquil();
  const raw = await AsyncStorage.getItem(DAILY_EXTRA_KEY);
  if (!raw) return { date: today, meters: 0, steps: 0, walks: 0 };
  const parsed = JSON.parse(raw) as DailyExtra;
  if (parsed.date !== today) return { date: today, meters: 0, steps: 0, walks: 0 };
  return parsed;
}

async function saveDailyExtra(extra: DailyExtra) {
  await AsyncStorage.setItem(DAILY_EXTRA_KEY, JSON.stringify(extra));
}

export async function getMissions(state?: IncentivesState): Promise<Mission[]> {
  const s = state ?? (await ensurePeriod());
  const extra = await loadDailyExtra();
  const defs = [...dailyDefs(), ...weeklyDefs()];
  return defs.map((def) => {
    const completed =
      def.type === 'daily'
        ? s.completedDailyIds.includes(def.id)
        : s.completedWeeklyIds.includes(def.id);
    const progress = progressFor(def, s, extra.meters, extra.steps, extra.walks);
    return {
      ...def,
      progress,
      done: completed || progress >= def.target,
    };
  });
}

async function tryCompleteMissions(state: IncentivesState): Promise<IncentivesState> {
  const missions = await getMissions(state);
  let next = { ...state };
  let gained = 0;
  const newlyCompleted: string[] = [];

  for (const m of missions) {
    const already =
      m.type === 'daily'
        ? next.completedDailyIds.includes(m.id)
        : next.completedWeeklyIds.includes(m.id);
    if (already) continue;
    if (m.progress < m.target) continue;

    if (m.type === 'daily') {
      next.completedDailyIds = [...next.completedDailyIds, m.id];
    } else {
      next.completedWeeklyIds = [...next.completedWeeklyIds, m.id];
    }
    gained += m.reward;
    newlyCompleted.push(m.id);
  }

  if (gained > 0) {
    next.points += gained;
    next = await lightStreak(next);
  }

  // bonuses
  const dailyIds = dailyDefs().map((d) => d.id);
  const weeklyIds = weeklyDefs().map((d) => d.id);
  const allDaily = dailyIds.every((id) => next.completedDailyIds.includes(id));
  const allWeekly = weeklyIds.every((id) => next.completedWeeklyIds.includes(id));

  if (allDaily && !next.dailyBonusClaimed) {
    next.points += 50;
    next.dailyBonusClaimed = true;
    newlyCompleted.push('bonus-daily');
  }
  if (allWeekly && !next.weeklyBonusClaimed) {
    next.points += 200;
    next.weeklyBonusClaimed = true;
    newlyCompleted.push('bonus-weekly');
  }

  if (newlyCompleted.length) {
    await save(next);
  }
  return next;
}

async function lightStreak(state: IncentivesState): Promise<IncentivesState> {
  const today = dateKeyGuayaquil();
  if (state.lastStreakDate === today) return state;

  const yesterdayDate = new Date(`${today}T12:00:00`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dateKeyGuayaquil(yesterdayDate);

  return {
    ...state,
    streak: state.lastStreakDate === yesterday ? state.streak + 1 : 1,
    lastStreakDate: today,
  };
}

/** Enciende racha (máx. 1 vez/día) por uso de Ruta Inteligente o misión. */
export async function markStreakActivity(): Promise<IncentivesState> {
  const state = await ensurePeriod();
  const next = await lightStreak(state);
  if (next.lastStreakDate !== state.lastStreakDate || next.streak !== state.streak) {
    await save(next);
    return next;
  }
  return state;
}

const VALID_WEEK_KEY = /^\d{4}-W\d{2}$/;

async function rolloverIfNeeded(state: IncentivesState): Promise<IncentivesState> {
  let next = { ...state };
  const today = dateKeyGuayaquil();
  const week = weekKeyGuayaquil();

  if (next.dailyKey !== today) {
    next.dailyKey = today;
    next.dailyRutaUses = 0;
    next.completedDailyIds = [];
    next.dailyBonusClaimed = false;
    // romper racha si saltó más de un día
    if (next.lastStreakDate) {
      const last = new Date(`${next.lastStreakDate}T12:00:00`);
      const now = new Date(`${today}T12:00:00`);
      const diff = Math.round((now.getTime() - last.getTime()) / 86400000);
      if (diff > 1) {
        next.streak = 0;
      }
    }
  }

  if (!VALID_WEEK_KEY.test(next.weekKey)) {
    // Clave guardada por la versión con el bug de fechas en Hermes ("NaN-WNaN"): no es un cierre de
    // semana real, así que solo se corrige la clave, sin premiar ni reiniciar el progreso.
    next.weekKey = week;
  } else if (next.weekKey !== week) {
    // premiar ranking de la semana que termina
    const rank = yourRank(next);
    const reward = rankingBracketReward(rank);
    next.points += reward;
    next.lastWeeklyRewardNote = `Semana ${next.weekKey}: quedaste #${rank} → +${reward} pts`;
    next.weekKey = week;
    next.weeklySteps = 0;
    next.weeklyDistanceM = 0;
    next.weeklyDestinations = [];
    next.weeklyWalks = 0;
    next.completedWeeklyIds = [];
    next.weeklyBonusClaimed = false;
  }

  return next;
}

export async function ensurePeriod(): Promise<IncentivesState> {
  const state = await loadRaw();
  const next = await rolloverIfNeeded(state);
  if (JSON.stringify(next) !== JSON.stringify(state)) {
    await save(next);
    return tryCompleteMissions(next);
  }
  return tryCompleteMissions(next);
}

export async function getIncentives(): Promise<IncentivesState> {
  return ensurePeriod();
}

export async function recordRutaInteligenteUse(): Promise<IncentivesState> {
  let state = await ensurePeriod();
  // Una sola cuenta por día para la misión "Explorador", pero la racha sí se enciende.
  const already = state.dailyRutaUses > 0;
  state = {
    ...state,
    dailyRutaUses: already ? state.dailyRutaUses : state.dailyRutaUses + 1,
  };
  state = await lightStreak(state);
  await save(state);
  state = await tryCompleteMissions(state);
  return state;
}

/** ~1 punto cada 20 m + tracking semanal/diario/misiones. */
export async function registerValidatedWalk(
  distanceM: number,
  opts?: { steps?: number; destinationId?: string }
): Promise<IncentivesState> {
  let state = await ensurePeriod();
  const gained = Math.max(1, Math.round(distanceM / 20));
  const steps = opts?.steps ?? Math.max(20, Math.round(distanceM / 0.75));

  const extra = await loadDailyExtra();
  extra.meters += distanceM;
  extra.steps += steps;
  extra.walks += 1;
  await saveDailyExtra(extra);

  const dests = new Set(state.weeklyDestinations);
  if (opts?.destinationId) dests.add(opts.destinationId);

  state = {
    ...state,
    points: state.points + gained,
    totalDistanceM: state.totalDistanceM + distanceM,
    walksCompleted: state.walksCompleted + 1,
    weeklySteps: state.weeklySteps + steps,
    weeklyDistanceM: state.weeklyDistanceM + distanceM,
    weeklyWalks: state.weeklyWalks + 1,
    weeklyDestinations: [...dests],
  };
  state = await lightStreak(state);
  await save(state);
  state = await tryCompleteMissions(state);
  return state;
}

export function rewardsCatalog() {
  return [
    { id: 'r1', title: 'Café 10% dto.', cost: 80, place: 'Cafetería campus' },
    { id: 'r2', title: 'Snack saludable', cost: 120, place: 'Comedor' },
    { id: 'r3', title: 'Kit eco ESPOL', cost: 250, place: 'Bienestar' },
  ];
}

export function rankingResetHint() {
  return `Reinicio: domingo ${nextSundayResetLabel()} (Guayaquil)`;
}

export function bracketLegend() {
  return [
    { range: '#1', points: 500 },
    { range: '#2–#5', points: 300 },
    { range: '#6–#10', points: 180 },
    { range: '#11–#20', points: 100 },
    { range: '#21–#40', points: 60 },
    { range: '#41–#80', points: 30 },
    { range: '#81+', points: 15 },
  ];
}
