// Synthetic additions to the gallery fixture. Served by the browser test only;
// no live store, credentials, private inputs or production renderer hooks.
export const prepareOverflowFixture = `
window.overflowFixture = { c, fixtures };
const names = ['Synthetic explorer with an exceptionally long first name', 'Synthetic partner with an exceptionally long second name'];
c.state.members.forEach((member, index) => { member.name = names[index]; });
const requested = new URLSearchParams(location.search);
if (requested.get('members') === '3') c.state.members.push({ ...structuredClone(c.state.members[1]), id:'player3', name:'Synthetic third explorer with an exceptionally long name' });
c.state.members[0].notes['12342'] = 'Synthetic note';
c.world.resourceContents.get('12342').Connect = { 'Sample cellar':true };
c.world.sectionTopology.set('12342', new Map());
c.applySession({admin:true});
for(const id of ['invites-open','overlays-open','usage-open'])c.$(id).hidden=false;
c.renderState();
c.map.onContext = (id, x, y, pointer) => c.chunkMenu(id, x, y, pointer);
const { createTopBarLayout } = await import('./top-bar-buttons.mjs');
window.overflowFixture.topBar = createTopBarLayout({ document });
`;
