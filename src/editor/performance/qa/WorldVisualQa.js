import { WorldVisualMotion,WORLD_VISUAL_MOTION_SCHEMA_VERSION } from './WorldVisualMotion.js';
import { staticLightingComponents,staticLightingChange } from './WorldVisualLighting.js';
import { worldVisualPreparation } from './WorldVisualPreparation.js';
import { PerfCounters } from './PerfCounters.js';
import { trackedWorldResources } from './WorldVisualResources.js';
import { treeImpostorIntegrity } from '../../stylized/impostor/TreeImpostorIntegrity.js';
import { worldVisualNeighborhood } from './WorldVisualNeighborhood.js';
import { setWaterTimeOverride } from '../../water/WaterVisualClock.js';
import { WorldVisualLayerControls, worldVisualVegetation } from './WorldVisualVegetation.js';
import { findBiomeSurfacePose, liveDryHeading, stageSurfaceDemo } from './WorldVisualSurfaceDemo.js';
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** Dev-only browser adapter. Navigation uses the engine's transaction, never private predictor fields. */
export class WorldVisualQa {
  constructor(editor) { this.editor=editor; this.disposed=false;this.weatherSimulationSeconds=0;this.motionSchemaVersion=WORLD_VISUAL_MOTION_SCHEMA_VERSION;this.layers=new WorldVisualLayerControls(editor); }
  async loadWorld(name) {
    if(name!=='eldara')throw new Error(`Unknown visual fixture world: ${name}`);
    const {importAzgaarFullJson}=await import('../../import/AzgaarJsonImporter.js');
    const response=await fetch('/maps/Eldara%20Full%202026-07-23-20-37.json');
    if(!response.ok)throw new Error('Cannot fetch the frozen imported map.');
    const document=importAzgaarFullJson(await response.json(),this.editor.config);
    await this.editor.controller.loadDocument(document);
  }
  async loadSynthetic() {
    const {createVisualSyntheticDocument,selectVisualSyntheticRoute,VISUAL_SYNTHETIC}=await import('./WorldVisualSynthetic.js');
    await this.editor.controller.loadDocument(createVisualSyntheticDocument(this.editor.controller.toDocument()));
    const {centerX,centerZ}=VISUAL_SYNTHETIC;
    await this.cut({x:centerX-64,z:centerZ+40,yaw:0,pitch:-.08,mode:'player'});await this.settle();
    return {...VISUAL_SYNTHETIC,...selectVisualSyntheticRoute(this.editor)};
  }
  async syntheticIdentity() {
    const {visualSyntheticIdentity}=await import('./WorldVisualSynthetic.js');return visualSyntheticIdentity(this.editor);
  }
  async syntheticResidency() {
    const {visualSyntheticResidency}=await import('./WorldVisualSynthetic.js');return visualSyntheticResidency(this.editor);
  }
  async cut(pose) {
    this.layers.restore();
    this.preparedMotion=null;this.motion?.stop(new Error('Visual motion interrupted by a camera cut.'));
    this.editor.playerController.setHarnessActive(true);
    const result=await this.editor.cameraCutCoordinator.cut(pose);
    if(pose.fov) {this.editor.viewModeController.camera.fov=pose.fov;this.editor.viewModeController.camera.updateProjectionMatrix();}
    if(result.cancelled) throw new Error('Visual camera cut superseded.');
    return this.diagnostics();
  }
  readiness() {
    const e=this.editor, terrain=e.terrainView.getStreamingStatus(), scenery=e.stylizedSurface.getPreparationStatus();
    const collision=e.playerController.getStatus().collision.ready;
    const construction=!(PerfCounters.get('constructionQueueDepth')>0);
    return {ready:terrain.loading===0 && terrain.pendingCommits===0 && scenery.ready && collision && construction,
      terrain,scenery,collision,construction};
  }
  setCaptureUi(hidden) {
    if(this.editor.hudVisibility) return this.editor.hudVisibility.setCapture(hidden);
    // VQ-03 capture roots; VQ-11 supplies the public controller and input policy.
    for(const root of document.querySelectorAll('[data-capture-ui]')) root.style.visibility=hidden?'hidden':'';
    return true;
  }
  diagnostics() {
    const e=this.editor, camera=e.viewModeController.camera, origin=e.terrainView.floatingOrigin;
    const canonical=origin.toCanonical(camera.position.x,camera.position.z);
    const cell=e.terrainView.worldStore.tileSize;
    const placements={};
    for(const name of ['tree','rock','bush']) {
      const view=e.stylizedSurface[`${name}View`];
      const values=name==='tree'?[...(view?.manifestStore?.cache.values()??[])].flatMap(entry=>entry.placements??[]):view?.placements??[];
      placements[name]=values.map(p=>p.stableId??`${p.x}:${p.z}`).sort();
    }
    return {canonical,origin:origin.getState(),camera:camera.position.toArray(),yaw:e.playerController.yaw,pitch:e.playerController.pitch,
      assetIntegrity:treeImpostorIntegrity(e.stylizedSurface.treeView),
      actualBiomeId:e.terrainView.worldStore.getTile(Math.floor(canonical.x/cell),Math.floor(-canonical.z/cell)),
      readiness:this.readiness(),placements,preparationDetail:worldVisualPreparation(e),preparationJobs:Object.fromEntries([
        ...['grass','flower','tree','rock','bush','detail'].map(name=>[name,e.stylizedSurface[`${name}BuildQueue`]]),
        ['treeManifest',e.stylizedSurface.treeView?.manifestStore?.queue],['rockManifest',e.stylizedSurface.rockView?.manifestStore?.queue],
      ].map(([name,queue])=>[name,queue?.getDiagnostics({includeJobs:true})??null])),resources:trackedWorldResources(e),counters:PerfCounters.snapshot(),
      sky:e.skyLooks?.current,wind:e.worldWind?.getState?.()??(e.worldWind?{
        time:e.worldWind.time,directionDegrees:e.worldWind.directionDegrees,intensity:e.worldWind.intensity,
        centerCanonical:{...e.worldWind.centerCanonical},params:{...e.worldWind.params}}:null),weather:{...e.weatherSettings},
      renderPath:e.terrainView.activeRenderPath??'unknown',finishApplications:e.terrainView.finishApplications??0,
      contactOcclusion:e.terrainView.godRays?.getSettings?.().contactOcclusionEnabled??false,
      buildingWetness:e.surfaceWetness?.buildingValues.toArray()??null,
      environment:{loaded:!!e.terrainView.scene.environment,intensity:e.terrainView.scene.environmentIntensity},
      waterReflections:e.stylizedSurface.reflections?.getDiagnostics?.()??null,
      backend:e.terrainView.rendererBackendStatus?.mode,clock:{hour:e.dayNightCycle?.hour,paused:e.dayNightCycle?.paused}};
  }
  async settle({minimumMs=16000,timeoutMs=120000}={}) {
    const start=performance.now();let readyFrames=0,last;
    while(performance.now()-start<timeoutMs && !this.disposed) {
      await frame(); last=this.readiness();
      readyFrames=performance.now()-start>=minimumMs && last.ready?readyFrames+1:0;
      if(readyFrames>=60) return {waitedMs:performance.now()-start,readyFrames,...last};
    }
    throw new Error(`Visual scenery did not settle: ${JSON.stringify(last)}`);
  }
  async setLighting({preset='highfield',hour=12,weather='off'}={}) {
    const e=this.editor;
    e.dayNightCycle?.setPaused(true);e.dayNightCycle?.setHour(hour);e.skyLooks?.setPreset(preset);
    e.weatherSettings.weatherMode=weather;e.weatherSettings.weatherIntensity=weather==='off'?0:1;
    e.weatherController?.applySettings();
    await e.stylizedSurface.skyView.environment.ready;
  }
  setWaterTime(seconds = null) { setWaterTimeOverride(seconds); }
  findBiomeSurfacePose(tileId, options) {
    const store=this.editor.terrainView.worldStore;
    return findBiomeSurfacePose(store.generator,store.tileSize??this.editor.config.map.tileSize,tileId,options);
  }
  stageSurfaceDemo(options) { return stageSurfaceDemo(this.editor, options); }
  liveDryHeading(awayFrom, fallback) { return liveDryHeading(this.editor, awayFrom, fallback); }
  /** The player's own body (and its shadow) out of a capture, or back. */
  setAvatarVisible(visible) {
    const view=this.editor.characterView;if(!view)return false;
    view.captureHidden=!visible;view.setVisible(visible);return true;
  }
  look({yaw,pitch}) { this.editor.playerController.setPose({yaw,pitch}); return this.diagnostics(); }
  neighborhood() { return worldVisualNeighborhood(this.editor); }
  vegetation(options) { return worldVisualVegetation(this.editor, options); }
  setLayers(values) { return this.layers.set(values); }
  async prepareMotion({startPose,cameraMode='first-person',sequenceId='walk-sprint-turn-v1'}) {
    if(sequenceId!=='walk-sprint-turn-v1'||!['first-person','third-person'].includes(cameraMode)) throw new Error('Invalid visual motion sequence.');
    await this.cut(startPose);await this.settle();
    const e=this.editor,view=e.viewModeController;
    const wantThird=cameraMode==='third-person';
    if(view.isThirdPerson!==wantThird&&!view.toggleCameraView())throw new Error('Requested motion camera is unavailable.');
    view.thirdPersonCamera?.reset();
    const readiness=await this.settle({minimumMs:0});
    this.preparedMotion={startPose,cameraMode,sequenceId};
    return {readiness,diagnostics:this.diagnostics()};
  }
  async runMotion(options) {
    const {prepared=false,startPose:requestedPose,cameraMode:requestedMode='first-person',sequenceId:requestedSequence='walk-sprint-turn-v1'}=options;
    const request={startPose:requestedPose,cameraMode:requestedMode,sequenceId:requestedSequence};
    if(!prepared)await this.prepareMotion(request);
    const {startPose,cameraMode,sequenceId}=this.preparedMotion??{};
    if(!startPose||JSON.stringify(request)!==JSON.stringify({startPose,cameraMode,sequenceId}))throw new Error('Motion recording needs the same fully prepared request.');
    const e=this.editor,view=e.viewModeController,canonical=e.terrainView.floatingOrigin.toCanonical(e.playerController.state.x,e.playerController.state.z);
    if(!this.readiness().ready||view.isThirdPerson!==(cameraMode==='third-person')||Math.hypot(canonical.x-startPose.x,canonical.z-startPose.z)>.01)throw new Error('Motion preparation became stale.');
    this.preparedMotion=null;
    const motion=new WorldVisualMotion(e,{startPose,cameraMode,readiness:()=>this.readiness()});
    this.motion=motion;
    try{return await motion.finished;}finally{if(this.motion===motion)this.motion=null;e.playerController.setHarnessKeys([]);}
  }
  beforeMovement(timestamp) {this.motion?.beforeMovement(timestamp);}
  afterFrame(timestamp,wetnessDeltaSeconds) {
    this.weatherSimulationSeconds+=Math.max(0,wetnessDeltaSeconds);
    this.motion?.afterFrame(timestamp);
  }
  async warmWeather(seconds=20) {
    const start=this.weatherSimulationSeconds,wall=performance.now();
    while(this.weatherSimulationSeconds-start<seconds&&!this.disposed) {
      if(performance.now()-wall>120000)throw new Error('Weather simulation did not advance.');
      await frame();
    }
    return {simulationSeconds:this.weatherSimulationSeconds-start,wetness:this.editor.surfaceWetness.value,wallMs:performance.now()-wall};
  }
  async settleLighting({timeoutMs=120000}={}) {
    const start=performance.now();let previous=null,stableFrames=0,maximumChange=Infinity;
    while(performance.now()-start<timeoutMs&&!this.disposed) {
      await frame();const current=staticLightingComponents(this.editor);maximumChange=staticLightingChange(previous,current);
      stableFrames=maximumChange<.001?stableFrames+1:0;previous=current;
      if(stableFrames>=60)return {stableFrames,maximumChange,components:current,wallMs:performance.now()-start};
    }
    throw new Error('Static sky, lights and fog failed to converge.');
  }

  dispose() {this.layers.restore();setWaterTimeOverride(null);this.motion?.stop(new Error('Visual motion disposed.'));this.disposed=true;this.editor.playerController.setHarnessKeys([]);this.setCaptureUi(false);}
}
