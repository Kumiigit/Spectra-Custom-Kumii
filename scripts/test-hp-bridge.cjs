const assert=require('node:assert/strict');
const {createHpBridge}=require('./hp-bridge.cjs');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/services/localHp.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {applyLocalHp}=context.exports;
const player={name:'Mxr1a',fullName:'Mxr1a#TEST',isAlive:true,health:100,auxiliaryAvailable:{health:false}};
const match={teams:[{players:[player]},{players:[]}]};
const reading={groupCode:'TEST',playerName:'Mxr1a',hp:36,updatedAt:1000};
assert.equal(applyLocalHp(match,reading,'TEST',1100).teams[0].players[0].health,36);
assert.equal(match.teams[0].players[0].health,100);
assert.equal(applyLocalHp(match,reading,'OTHER',1100),match);
assert.equal(applyLocalHp(match,reading,'TEST',6000),match);
// Repeated Spectra updates with default 100 must keep the local HP through
// polling/background timer gaps, without refreshing the original timestamp.
for(const now of [1100,2600,4900]) {
  const serverUpdate={teams:[{players:[{...player,health:100}]},{players:[]}]};
  assert.equal(applyLocalHp(serverUpdate,{...reading,hp:35},'TEST',now).teams[0].players[0].health,35);
}
assert.equal(applyLocalHp(match,{...reading,hp:101},'TEST',1100),match);
assert.equal(applyLocalHp(match,{...reading,playerName:'Other'},'TEST',1100),match);
const dead={teams:[{players:[{...player,isAlive:false}]}]};
assert.equal(applyLocalHp(dead,reading,'TEST',1100),dead);
const low={...reading,hp:1};
assert.equal(applyLocalHp(match,low,'TEST',1100).teams[0].players[0].health,1);
assert.equal(applyLocalHp(dead,low,'TEST',1100),dead);
const unknownAlive={teams:[{players:[{...player,isAlive:undefined}]}]};
assert.equal(applyLocalHp(unknownAlive,low,'TEST',1100),unknownAlive);
const duplicate={teams:[{players:[player,{...player}]}]};
assert.equal(applyLocalHp(duplicate,reading,'TEST',1100),duplicate);
assert.equal(applyLocalHp({...match,roundNumber:2},{...reading,roundNumber:1},'TEST',1100).teams[0].players[0].health,100,'Old-round readings cannot apply');
(async()=>{
  const server=createHpBridge();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/hp`;
  const post=(data,origin='http://127.0.0.1:3000')=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    assert.equal(await(await fetch(url)).json(),null);
    assert.equal((await post(reading)).status,200);
    const state=await(await fetch(url)).json();assert.equal(state.hp,36);
    const leftPlayer={...player,name:'Mxr1as Booster',fullName:'Mxr1as Booster#TEST'};
    const twoPlayers={teams:[{players:[leftPlayer]},{players:[player]}]};
    await post({...reading,playerName:'Mxr1as Booster',hp:54});
    const both=await(await fetch(url+'/all')).json();assert.equal(both.length,2);
    const applied=applyLocalHp(twoPlayers,both,'TEST');
    assert.equal(applied.teams[0].players[0].health,54);
    assert.equal(applied.teams[1].players[0].health,36);
    await post({...reading,playerName:'Mxr1as Booster',hp:null});
    const remaining=await(await fetch(url+'/all')).json();assert.equal(remaining.length,1);assert.equal(remaining[0].playerName,'Mxr1a');
    assert.equal(applyLocalHp(match,state,'TEST').teams[0].players[0].health,36);
    assert.equal((await post({...reading,hp:-1})).status,400);
    assert.equal((await post(reading,'https://example.com')).status,403);
    await new Promise(resolve=>setTimeout(resolve,1600));
    assert.equal((await(await fetch(url+'/all')).json()).length,1,'A 1.6 second delivery gap must retain the reading');
    await new Promise(resolve=>setTimeout(resolve,3500));
    assert.equal(await(await fetch(url)).json(),null);
    assert.equal((await(await fetch(url+'/all')).json()).length,0);
    await post({...reading,hp:0});assert.equal((await(await fetch(url)).json()).hp,0);
    await post({...reading,hp:null});assert.equal(await(await fetch(url)).json(),null);
    {
    const stateUrl=url+'/state';
    const publish=async state=>{const response=await fetch(stateUrl,{method:'POST',headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:JSON.stringify(state)});assert.equal(response.status,200);return response.json();};
    const lifecycle={groupCode:'LIFE',roundNumber:3,roundPhase:'combat',map:'Ascent',isRunning:true,players:[{name:'Mxr1a',fullName:'Mxr1a#TEST',isAlive:true},{name:'Other',fullName:'Other#TEST',isAlive:true}]};
    let state=await publish(lifecycle),oldEpoch=state.players[0].epoch,otherEpoch=state.players[1].epoch;
    const hp={groupCode:'LIFE',playerName:'Mxr1a',hp:84,epoch:oldEpoch};
    assert.equal((await post(hp)).status,200);
    await post({groupCode:'LIFE',playerName:'Other',hp:75,epoch:otherEpoch});
    assert.equal((await publish(lifecycle)).players[0].epoch,oldEpoch,'Repeated match packets cannot reset HP');
    state=await publish({...lifecycle,players:[{...lifecycle.players[0],isAlive:false},lifecycle.players[1]]});
    assert.equal(state.players[1].epoch,otherEpoch,'Another player dying must not reset the survivor');
    assert.equal((await(await fetch(url+'/all')).json()).filter(r=>r.groupCode==='LIFE').length,1,'Death clears only the dead player');
    assert.equal((await post(hp)).status,409,'Late pre-death heartbeat must be rejected');
    state=await publish(lifecycle);
    assert.notEqual(state.players[0].epoch,oldEpoch,'Resurrection must require fresh reader confirmation');
    assert.equal((await post(hp)).status,409,'Held pre-death HP cannot return after resurrection');
    hp.epoch=state.players[0].epoch;assert.equal((await post(hp)).status,200);
    state=await publish({...lifecycle,roundNumber:4,roundPhase:'shopping'});
    assert.equal((await(await fetch(url+'/all')).json()).filter(r=>r.groupCode==='LIFE').length,0,'New round clears every player');
    assert.equal((await post(hp)).status,409,'Old-round heartbeat must not resurrect readings');
    hp.epoch=state.players[0].epoch;assert.equal((await post(hp)).status,200);
    state=await publish({...lifecycle,roundNumber:4,roundPhase:'combat'});const combatEpoch=state.players[0].epoch;
    state=await publish({...lifecycle,roundNumber:4,roundPhase:'shopping'});
    assert.notEqual(state.players[0].epoch,combatEpoch,'Entering a new buy phase clears even if round number is unchanged');
    assert.equal((await post({...hp,epoch:combatEpoch})).status,409);
    assert.equal((await(await fetch(stateUrl+'?groupCode=LIFE')).json()).roundNumber,4);
    console.log('PASS: Spectra lifecycle, isolated death clearing, resurrection, round/buy resets and late heartbeat rejection');
    }
    console.log('PASS: bridge delivery, scope, range, expiry, clear, zero, origins, name matching, dead players and immutable fallback');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
