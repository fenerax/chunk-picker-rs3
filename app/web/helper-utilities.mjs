import { helperSkills, helperTrialCaps, personalSkillProgress, xpLookup, combatProjection } from './helper-model.mjs';
import { dataTable } from './helper-charts.mjs';
import { xpForLevel } from '../core/experience.mjs';
export function renderUtilities(host, { document, member, draft }) {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const field = (label, input) => { const n = el('label', label); n.append(input); return n; };
  host.append(el('h2', 'XP & combat'), el('p', 'Look up a level, or try different combat levels without changing your saved progress.', 'helper-intro'));
  const section = el('section', undefined, 'helper-utility'), form = el('form', undefined, 'helper-form'), xp = el('input'), output = el('div');
  xp.type = 'number'; xp.min = 0; xp.max = 200000000; xp.step = 0.1; xp.value = draft?.xp ?? '0'; xp.required = true; output.setAttribute('aria-live', 'polite');
  const button = el('button', 'Look up XP'); button.type = 'submit'; form.append(field('Experience points', xp), button);
  function lookup(event) { event?.preventDefault(); if (!form.checkValidity()) { if (event) form.reportValidity(); return; } try { const value = xpLookup(Number(xp.value)); output.replaceChildren(el('p', `Level ${value.level} · ${value.xpToNext === null ? 'Standard curve ends at 120' : `${value.xpToNext.toLocaleString()} XP to level ${value.nextLevel}`}`, 'helper-answer')); } catch (error) { output.textContent = error.message; } }
  form.addEventListener('submit', lookup); section.append(el('h3', 'XP to level'), el('p', 'Standard skill XP, up to level 120. Invention uses a different curve. F2P and trial caps still apply.'), form, output); host.append(section); lookup();
  const levelsSection = el('section', undefined, 'helper-utility'), levelsForm = el('form', undefined, 'helper-form'), level = el('input'), levelOutput = el('div');
  levelOutput.setAttribute('aria-live', 'polite');
  level.type = 'number'; level.min = 1; level.max = 120; level.step = 1; level.value = draft?.level ?? '60'; level.required = true;
  const levelButton = el('button', 'Look up level'); levelButton.type = 'submit'; levelsForm.append(field('Target level', level), levelButton);
  // Reuse the lookup curve at the exact level floor.
  levelsForm.addEventListener('submit', event => { event.preventDefault(); if (!levelsForm.checkValidity()) { levelsForm.reportValidity(); return; } levelOutput.textContent = `Level ${level.value} starts at ${xpForLevel(Number(level.value)).toLocaleString()} XP.`; });
  levelsSection.append(el('h3', 'Level to XP'), levelsForm, levelOutput); host.append(levelsSection);
  const combat = el('section', undefined, 'helper-utility'), combatForm = el('form', undefined, 'helper-form'), combatOutput = el('div'), progress = personalSkillProgress(member), fields = {};
  const skills = ['Attack', 'Strength', 'Defence', 'Constitution', 'Ranged', 'Magic', 'Prayer', 'Necromancy'];
  const initialLevels = {};
  for (const skill of skills) { const input = el('input'); input.type = 'number'; input.min = 1; input.max = skill === 'Necromancy' ? 20 : ['Defence', 'Constitution', 'Prayer'].includes(skill) ? 99 : 120; input.step = 1; input.required = true; initialLevels[skill] = String(Math.min(Number(input.max), progress[skill]?.level ?? 1)); input.value = draft?.combat?.[skill] ?? initialLevels[skill]; fields[skill] = input; combatForm.append(field(skill, input)); }
  const calculate = el('button', 'Calculate combat level'); calculate.type = 'submit'; combatForm.append(calculate); combatOutput.setAttribute('aria-live', 'polite');
  function showCombat(event) { event?.preventDefault(); if (!combatForm.checkValidity()) { if (event) combatForm.reportValidity(); return; } const levels = Object.fromEntries(skills.map(skill => [skill, Number(fields[skill].value)])); combatOutput.textContent = `F2P combat level ${combatProjection(levels)}`; }
  combatForm.addEventListener('submit', showCombat); combat.append(el('h3', 'Combat level'), el('p', 'Starts with your saved levels. Missing levels start at 1. The F2P formula ignores Summoning and caps Necromancy at 20.'), combatForm, combatOutput); host.append(combat); showCombat();
  host.append(dataTable(document, 'Saved personal levels', ['Skill', 'Level', 'XP'], helperSkills.map(skill => [helperTrialCaps[skill] ? `${skill} (F2P trial to ${helperTrialCaps[skill]})` : skill, progress[skill]?.level ?? 'Not synced', progress[skill]?.xp?.toLocaleString() ?? 'Unknown'])));
  const dispose = () => {};
  dispose.getDraft = () => ({ xp: xp.value, level: level.value, combat: Object.fromEntries(skills.filter(skill => fields[skill].value !== initialLevels[skill]).map(skill => [skill, fields[skill].value])) });
  return dispose;
}
