import { selectedDataset } from '../dataset-runtime.mjs';
import { supportsDatasetFeature, applyDatasetFeatureControls, applyDatasetLaunchCopy } from './dataset-features.mjs';

// One screen owns its saved view, request guards and bounded display caches.
export function createScreenContext() {
  const c = {
    accessSections: undefined,
    backupStatus: undefined,
    accessSectionsMember: undefined,
    categoryIconPainter: undefined,
    chunkDrafts: undefined,
    chunkId: undefined,
    chunkNoteReveal: undefined,
    chunkPlanning: undefined,
    chunkSearch: undefined,
    chunkSearchRequest: undefined,
    chunkTab: undefined,
    lastSaveControl: undefined,
    completedView: undefined,
    deathChunks: undefined,
    definitions: undefined,
    definitionsAreFull: undefined,
    dialogGeneration: undefined,
    dockObserver: undefined,
    dockPanels: undefined,
    duoCoordination: undefined,
    duoDetailRequests: undefined,
    duoDetails: undefined,
    duoHovers: undefined,
    duoInspectionCache: undefined,
    duoInspectionError: undefined,
    duoInspectionLoading: undefined,
    duoInspectionScope: undefined,
    duoLoadError: undefined,
    duoLoadScope: undefined,
    duoLoading: undefined,
    duoPins: undefined,
    duoResultCache: undefined,
    duoRowsReady: undefined,
    duoSelection: undefined,
    duoSelectionKey: undefined,
    duoTaskView: undefined,
    fieldSequence: undefined,
    foregroundTaskLoad: undefined,
    pendingGameplayAttempt: undefined,
    earlyTaskLoad: undefined,
    gameplayAttemptSequence: 0,
    latestEventRevision: 0,
    unchangedTaskRevisions: undefined,
    fullDefinitionsRequest: undefined,
    fullResult: undefined,
    fullResultRequest: undefined,
    infoPanels: undefined,
    lastDuoResults: undefined,
    map: undefined,
    mapAssets: undefined,
    mapTools: undefined,
    memberId: undefined,
    normalPlayResults: undefined,
    noticeTimer: undefined,
    originalSync: undefined,
    owners: undefined,
    panelContext: undefined,
    pendingChunkChanges: undefined,
    plain: undefined,
    planningRequests: undefined,
    planningResults: undefined,
    pool: undefined,
    predictions: undefined,
    predictionIntents: undefined,
    preferenceSignature: undefined,
    queue: undefined,
    registry: undefined,
    result: undefined,
    rollBusy: undefined,
    rulesPanel: undefined,
    sandbox: undefined,
    sessionAdmin: undefined,
    sessionMember: undefined,
    settingsPanels: undefined,
    shownChunkSignature: undefined,
    shownResult: undefined,
    state: undefined,
    stateIsPlayView: undefined,
    statePools: undefined,
    stickerFlyout: undefined,
    stickerPicker: undefined,
    syncTimer: undefined,
    taskController: undefined,
    taskFactsCache: undefined,
    taskFiltersView: undefined,
    taskHealth: undefined,
    taskHover: undefined,
    taskIconPainter: undefined,
    taskInFlight: undefined,
    taskListRows: undefined,
    taskPins: undefined,
    taskRenderDone: undefined,
    taskRenderGeneration: undefined,
    taskRequest: undefined,
    updates: undefined,
    world: undefined,
  };
  c.owners = (selectedDataset.gameDefaults?.members ?? []).map(({ id, name, mapId }) => ({ id, name, ...(mapId ? { mapId } : {}) }));
  c.taskRequest = 0;
  c.dialogGeneration = 0;
  c.queue = Promise.resolve();
  c.statePools = {};
  c.stateIsPlayView = false;
  c.taskInFlight = false;
  c.taskRenderGeneration = 0;
  c.taskRenderDone = Promise.resolve();
  c.definitionsAreFull = true;
  c.normalPlayResults = new Map();
  c.planningResults = new Map();
  c.planningRequests = new Map();
  c.taskListRows = new Map();
  c.rollBusy = false;
  c.mapAssets = null;
  c.accessSections = null;
  c.accessSectionsMember = null;
  c.chunkDrafts = new Map();
  c.pendingChunkChanges = [];
  c.lastDuoResults = [];
  c.duoRowsReady = false;
  c.duoDetails = new Map();
  c.duoDetailRequests = new Map();
  c.duoHovers = new Map();
  c.predictions = new Map();
  c.predictionIntents = new Map();
  c.sessionAdmin = false;
  c.sessionMember = null;
  c.sessionReadOnly = false;
  c.viewerPreferences = {};
  c.canWrite = () => !c.sessionReadOnly;
  c.dataset = selectedDataset;
  c.supportsFeature = feature => supportsDatasetFeature(c.dataset, feature);
  c.applyDatasetControls = () => applyDatasetFeatureControls(c.dataset, c.$);
  c.applyDatasetCopy = () => applyDatasetLaunchCopy(c.dataset, document);
  return c;
}
