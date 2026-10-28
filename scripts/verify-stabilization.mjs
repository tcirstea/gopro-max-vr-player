// Optional local-media check; never prints a filename or raw sensor values.
// Usage: node scripts/verify-stabilization.mjs /private/path/to/clip.360
import {openAsBlob} from 'node:fs';
import {demuxNative} from '../src/native-demux.js';
import {createMaxStabilization} from '../src/max-stabilization.js';
if(process.argv.length!==3){console.error('Usage: node scripts/verify-stabilization.mjs /private/path/to/clip.360');process.exit(2);}
let movie,stabilization;
try{
 const file=await openAsBlob(process.argv[2]);movie=await demuxNative(file);stabilization=await createMaxStabilization(file,movie.tracks[0].samples);
 let corrected=0;for(const sample of movie.tracks[0].samples)if(await stabilization.prepare(sample.timestamp))corrected++;
 console.log(JSON.stringify({videoFrames:movie.tracks.map(t=>t.samples.length),correctedFrames:corrected,stabilization:stabilization.getDiagnostics()},null,2));
 if(!corrected)process.exitCode=1;
}finally{stabilization?.close();movie?.close();}
