import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createBrowserErrorMonitor} from './lib/perf-browser-errors.mjs';
import {waitForPerfRunLock} from './perf-run-lock.mjs';

// Times a closed Highfield loop: preparation, first lap and repeat lap, with no capture while timed.
const option=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const url=option('--url','http://localhost:5173'),out=path.resolve(option('--out','tmp/highfield-grass/tour.json'));
const hitchMs=1000/30;
const manifest=JSON.parse(await readFile('docs/qa/world-visual-quality-2026-10-14/biomes/procedural-review-poses.json','utf8'));
const pose=manifest.original.find(p=>p.id==='original-04');
const release=await waitForPerfRunLock(path.resolve('tmp',`perf-browser-${process.platform}.lock`));
const summarize=frames=>{
 const dt=frames.map(f=>f.dt).sort((a,b)=>a-b),at=q=>dt[Math.min(dt.length-1,Math.floor(dt.length*q))];
 const hitches=dt.filter(v=>v>hitchMs).length;
 return {frames:dt.length,p95:at(.95),p99:at(.99),max:dt.at(-1),hitches,hitchPercent:100*hitches/dt.length,
  worst:frames.map((f,i)=>({...f,previous:frames[i-1]})).sort((a,b)=>b.dt-a.dt).slice(0,8)};
};
const report={url,pose,startedAt:new Date().toISOString()};let browser;
try {
 browser=await chromium.launch({headless:false,args:['--enable-unsafe-webgpu','--ignore-gpu-blocklist','--use-angle=default','--disable-gpu-vsync','--disable-frame-rate-limit']});
 const page=await (await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1})).newPage();
 const errors=createBrowserErrorMonitor(page);
 await page.bringToFront();
 await page.goto(new URL('/?qaVisual=1',url).href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__worldVisualQa,null,{timeout:180000});
 await page.evaluate(()=>window.__worldVisualQa.setLighting({preset:'highfield',hour:12,weather:'off'}));
 await page.evaluate(p=>window.__worldVisualQa.cut(p),pose);
 await page.evaluate(()=>window.__worldVisualQa.settle({minimumMs:16000}));
 report.adapter=await page.evaluate(()=>window.__editor.terrainView.rendererBackendStatus.mode);
 report.points=await page.evaluate(()=>window.__editor.exploration.tour.localRoute().map(({x,y,z})=>({x,y,z})));
 report.durationSeconds=await page.evaluate(()=>window.__editor.exploration.tour.settings.durationSeconds);
 for(const lap of ['first','repeat']) {
  const result=await page.evaluate(async points=>{
   const {PerfCounters}=await import('/src/editor/performance/qa/PerfCounters.js');
   const tour=window.__editor.exploration.tour,started=performance.now();
   await tour.start(points);
   const preparedMs=performance.now()-started,frames=[];
   let last=performance.now(),previous=PerfCounters.snapshot();
   while(tour.active) {
    await new Promise(requestAnimationFrame);
    const now=performance.now(),dt=now-last;last=now;
    const counters=PerfCounters.snapshot(),changed={};
    // Numeric gauges and totals both surface here; the frame diff keeps the report small.
    for(const key in counters)if(typeof counters[key]==='number'&&counters[key]!==previous[key])changed[key]=counters[key]-(previous[key]??0);
    previous=counters;
    frames.push({dt,progress:tour.elapsed/tour.settings.durationSeconds,x:tour.point.x,z:tour.point.z,...(dt>1000/30?{changed}:{})});
   }
   return {preparedMs,frames,focused:document.hasFocus()};
  },report.points);
  report[lap]={preparedMs:result.preparedMs,focused:result.focused,...summarize(result.frames)};
  console.log(lap,JSON.stringify({...report[lap],worst:undefined}));
 }
 report.errors=errors.snapshot();
 if(report.errors.count)process.exitCode=1;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{await browser?.close();release();report.finishedAt=new Date().toISOString();await mkdir(path.dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2));}
