import test from 'node:test';
import assert from 'node:assert/strict';
import { shortMemberName, memberDisplay, memberSelect, createScreenUi } from '../app/web/screen-ui.mjs';

const node = (textContent = '') => ({ textContent, children:[], attributes:{}, listeners:{},
  append(...items) { this.children.push(...items); },
  setAttribute(key,value) { this.attributes[key]=value; },
  getAttribute(key) { return this.attributes[key] ?? null; },
  addEventListener(key,value) { (this.listeners[key] ??= []).push(value); },
});

test('member names cap by Unicode character and leave short names intact', () => {
  assert.equal(shortMemberName('Explorer'), 'Explorer');
  assert.equal(shortMemberName('x'.repeat(20)), 'x'.repeat(20));
  assert.equal(shortMemberName('x'.repeat(21)), 'x'.repeat(20)+'…');
  assert.equal(shortMemberName('🧭'.repeat(21)), '🧭'.repeat(20)+'…');
});

test('compact labels preserve full accessible names and never mutate members', () => {
  const members = [{ id:'one', name:'Synthetic explorer with a long name' }];
  const original = structuredClone(members);
  const label = node('Claim for '+members[0].name);
  memberDisplay(label,members);
  assert.equal(label.textContent,'Claim for '+shortMemberName(members[0].name));
  assert.equal(label.title,'Claim for '+members[0].name);
  assert.equal(label.attributes['aria-label'],label.title);
  assert.deepEqual(members,original);
});

test('select values remain IDs and full accessible labels follow selection', () => {
  const members = [{id:'one',name:'Synthetic first explorer with a long name'}, {id:'two',name:'Synthetic second explorer with a long name'}];
  const picker = node(); picker.value='one'; picker.setAttribute('aria-label','Task owner');
  picker.children=members.map(member=>Object.assign(node(member.name),{value:member.id}));
  memberSelect(picker,members);
  assert.equal(picker.title,members[0].name);
  for(const [index,option] of picker.children.entries()) {
    assert.equal(option.textContent,shortMemberName(members[index].name));
    assert.equal(option.attributes['aria-label'],members[index].name);
    assert.equal(option.value,members[index].id);
  }
  picker.value='two'; picker.listeners.change[0]();
  assert.equal(picker.title,members[1].name);
  assert.equal(picker.attributes['aria-label'],'Task owner: '+members[1].name);
  memberSelect(picker,members);
  assert.equal(picker.listeners.change.length,1,'redraws do not add listeners');
});

test('ordinary task text is preserved even when it contains a long member name', () => {
  const name = 'Synthetic explorer with a long name', label = 'A task mentioning ' + name;
  const previous = globalThis.document;
  globalThis.document = { createElement: () => node() };
  try {
    const c = { state:{ members:[{id:'one',name}] } }; createScreenUi(c);
    assert.equal(c.button(label,()=>{}).textContent,label);
    assert.equal(c.select([{value:'task-id',label}], 'task-id').children[0].textContent,label);
    const chooser = c.select([{value:'one',label:name}], 'one');
    assert.equal(chooser.children[0].textContent,shortMemberName(name));
    assert.equal(chooser.title,name);
  } finally { globalThis.document=previous; }
});
