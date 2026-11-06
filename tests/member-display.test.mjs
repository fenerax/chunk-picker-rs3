// @test quick
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
    assert.equal(chooser.getAttribute('aria-label'),null,'an associated <label> keeps naming the select');
  } finally { globalThis.document=previous; }
});

test('generic text keeps the full name for assistive technology without aria-label', () => {
  const name = 'Synthetic explorer with a long name';
  const document = { createElement: tag => Object.assign(node(), { tagName: tag.toUpperCase() }) };
  const span = Object.assign(node(name + ' is doing this'), { tagName:'SPAN', ownerDocument:document,
    replaceChildren(...items) { this.children = items; this.textContent = items.map(item => item.textContent).join(''); },
    querySelector(selector) { return selector === ':scope > .member-name-full' ? this.children.find(child => child.className?.includes('member-name-full')) ?? null : null; },
  });
  memberDisplay(span, [{ name }]);
  const [visible, spoken] = span.children;
  assert.equal(visible.textContent, shortMemberName(name) + ' is doing this');
  assert.equal(visible.attributes['aria-hidden'], 'true');
  assert.equal(spoken.textContent, name + ' is doing this');
  assert.match(spoken.className, /sr-only/);
  assert.equal(span.attributes['aria-label'], undefined, 'generic elements are not named with aria-label');
  memberDisplay(span, [{ name }]);
  assert.equal(span.children[1].textContent, name + ' is doing this', 'repeat calls do not nest or lose text');
});

test('short names leave labels untouched, even as substrings of other words', () => {
  const chip = node('Members-only land');
  memberDisplay(chip, [{ name:'Me' }]);
  assert.equal(chip.textContent, 'Members-only land');
  assert.equal(chip.title, undefined);
  assert.equal(chip.attributes['aria-label'], undefined);
});

test('a select that no longer needs shortening drops the previous long name', () => {
  const long = { id:'one', name:'Synthetic explorer with a long name' }, short = { id:'two', name:'Reed' };
  const picker = node(); picker.setAttribute('aria-label','Task owner');
  picker.children = [Object.assign(node(long.name), { value:'one' })]; picker.value = 'one';
  memberSelect(picker, [long]);
  assert.equal(picker.title, long.name);
  picker.children = [Object.assign(node(short.name), { value:'two', title:'' })]; picker.value = 'two';
  memberSelect(picker, [short]);
  assert.equal(picker.title, 'Reed');
  assert.equal(picker.attributes['aria-label'], 'Task owner: Reed');
});

test('a reused label clears the old full name when the new name is short', () => {
  const chip = node('Synthetic explorer with a long name');
  memberDisplay(chip, [{ name:'Synthetic explorer with a long name' }]);
  assert.equal(chip.attributes['aria-label'], 'Synthetic explorer with a long name');
  chip.textContent = 'Reed';
  memberDisplay(chip, [{ name:'Reed' }]);
  assert.equal(chip.textContent, 'Reed');
  assert.ok(!chip.title, 'old tooltip removed');
  assert.equal(chip.attributes['aria-label'], undefined, 'old accessible name removed');
});

test('formatting the same select twice keeps full option names', () => {
  const members = [{ id:'one', name:'Synthetic first explorer with a long name' }, { id:'two', name:'Synthetic second explorer with a long name' }];
  const picker = node(); picker.setAttribute('aria-label','Helper player'); picker.value = 'one';
  picker.children = members.map(member => Object.assign(node(member.name), { value:member.id }));
  memberSelect(picker, members);
  picker.value = 'two'; memberSelect(picker, members);
  for (const [index, option] of picker.children.entries()) {
    assert.equal(option.textContent, shortMemberName(members[index].name));
    assert.equal(option.title, members[index].name);
    assert.equal(option.attributes['aria-label'], members[index].name);
  }
  assert.equal(picker.title, members[1].name);
  assert.equal(picker.attributes['aria-label'], 'Helper player: ' + members[1].name);
});
