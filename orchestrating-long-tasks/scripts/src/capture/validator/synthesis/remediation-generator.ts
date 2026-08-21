import type { CodeRemediation, CodeRemediationFramework } from "../types.ts";

interface CategoryTemplate {
  readonly description: string;
  readonly snippets: Readonly<Record<CodeRemediationFramework, string>>;
}

const REMEDIATION_TEMPLATES: Readonly<Record<string, CategoryTemplate>> = {
  "apca-contrast": {
    description: "Adjust text and background colors to satisfy APCA 0.98G minimum lightness contrast (Lc).",
    snippets: {
      react: `<span className="text-zinc-900 dark:text-zinc-50 bg-white dark:bg-zinc-950 font-medium">Accessible Text</span>`,
      "react-native": `<Text style={{ color: '#09090b', backgroundColor: '#ffffff', fontWeight: '500' }}>Accessible Text</Text>`,
      vue: `<span class="apca-contrast">Accessible Text</span>\n<style scoped>\n.apca-contrast { color: #09090b; background-color: #ffffff; font-weight: 500; }\n</style>`,
      svelte: `<span class="apca-contrast">Accessible Text</span>\n<style>\n  .apca-contrast { color: #09090b; background-color: #ffffff; font-weight: 500; }\n</style>`,
      css: `.apca-contrast {\n  color: light-dark(#09090b, #fafafa);\n  background-color: light-dark(#ffffff, #09090b);\n  font-weight: 500;\n}`,
    },
  },
  "touch-target": {
    description: "Expand touch target dimension to >= 44x44px and maintain >= 24px circular clearance.",
    snippets: {
      react: `<button className="min-w-[44px] min-h-[44px] p-3 inline-flex items-center justify-center rounded-lg">Touch Action</button>`,
      "react-native": `<Pressable hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>\n  <Text>Touch Action</Text>\n</Pressable>`,
      vue: `<button class="touch-target">Touch Action</button>\n<style scoped>\n.touch-target { min-width: 44px; min-height: 44px; padding: 12px; display: inline-flex; align-items: center; justify-content: center; }\n</style>`,
      svelte: `<button class="touch-target">Touch Action</button>\n<style>\n  .touch-target { min-width: 44px; min-height: 44px; padding: 12px; display: inline-flex; align-items: center; justify-content: center; }\n</style>`,
      css: `.touch-target {\n  min-width: 44px;\n  min-height: 44px;\n  padding: 12px;\n  margin: 12px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n}`,
    },
  },
  "concentric-radius": {
    description: "Align nested border radii to maintain concentricity: Outer Radius = Inner Radius + Padding.",
    snippets: {
      react: `<div className="p-4 rounded-[16px] border bg-card">\n  <div className="rounded-[8px] p-2 bg-muted">Nested Content</div>\n</div>`,
      "react-native": `<View style={{ padding: 16, borderRadius: 16, backgroundColor: '#f4f4f5' }}>\n  <View style={{ borderRadius: 8, padding: 8, backgroundColor: '#ffffff' }}>\n    <Text>Nested Content</Text>\n  </View>\n</View>`,
      vue: `<div class="card-outer">\n  <div class="card-inner">Nested Content</div>\n</div>\n<style scoped>\n.card-outer { padding: 16px; border-radius: calc(8px + 16px); }\n.card-inner { border-radius: 8px; }\n</style>`,
      svelte: `<div class="card-outer">\n  <div class="card-inner">Nested Content</div>\n</div>\n<style>\n  .card-outer { padding: var(--pad, 16px); border-radius: calc(var(--r-in, 8px) + var(--pad, 16px)); }\n  .card-inner { border-radius: var(--r-in, 8px); }\n</style>`,
      css: `:root {\n  --inner-r: 8px;\n  --pad: 16px;\n}\n.card-outer {\n  padding: var(--pad);\n  border-radius: calc(var(--inner-r) + var(--pad));\n}\n.card-inner {\n  border-radius: var(--inner-r);\n}`,
    },
  },
  "subpixel-snapping": {
    description: "Round coordinates and CSS transforms to whole integer pixels to avoid blurry subpixel rendering.",
    snippets: {
      react: `<div className="transform translate-x-[10px] translate-y-[20px] will-change-transform">\n  Snapped Content\n</div>`,
      "react-native": `<View style={{ transform: [{ translateX: Math.round(10.0) }, { translateY: Math.round(20.0) }] }}>\n  <Text>Snapped Content</Text>\n</View>`,
      vue: `<div class="pixel-snapped">Snapped Content</div>\n<style scoped>\n.pixel-snapped { transform: translate(10px, 20px); }\n</style>`,
      svelte: `<div class="pixel-snapped">Snapped Content</div>\n<style>\n  .pixel-snapped { transform: translate(10px, 20px); }\n</style>`,
      css: `.pixel-snapped {\n  transform: translate(round(nearest, 10px, 1px), round(nearest, 20px, 1px));\n}`,
    },
  },
  "cls-reservation": {
    description: "Reserve width, height, or aspect-ratio upfront to eliminate Cumulative Layout Shift (CLS).",
    snippets: {
      react: `<img src="/hero.webp" width={800} height={450} className="w-full h-auto aspect-video object-cover" alt="Hero media" loading="eager" fetchPriority="high" />`,
      "react-native": `<Image source={{ uri: 'https://example.com/hero.webp' }} style={{ width: '100%', aspectRatio: 16 / 9 }} />`,
      vue: `<img :src="heroUrl" width="800" height="450" class="aspect-reserved" alt="Hero media" />\n<style scoped>\n.aspect-reserved { aspect-ratio: 16 / 9; width: 100%; height: auto; }\n</style>`,
      svelte: `<img src={heroUrl} width="800" height="450" class="aspect-reserved" alt="Hero media" />\n<style>\n  .aspect-reserved { aspect-ratio: 16 / 9; width: 100%; height: auto; }\n</style>`,
      css: `img, video, iframe {\n  aspect-ratio: 16 / 9;\n  width: 100%;\n  height: auto;\n  contain-intrinsic-size: 800px 450px;\n}`,
    },
  },
  "cowan-chunking": {
    description: "Partition dense information into 4±1 chunks or categorized subsections to reduce cognitive load.",
    snippets: {
      react: `<nav className="flex flex-col gap-6">\n  {sections.map(section => <NavGroup key={section.id} title={section.title} items={section.items} />)}\n</nav>`,
      "react-native": `<SectionList sections={groupedSections} renderSectionHeader={({ section }) => <Text style={{ fontWeight: 'bold' }}>{section.title}</Text>} renderItem={({ item }) => <NavItem item={item} />} />`,
      vue: `<nav class="chunked-nav">\n  <section v-for="grp in groups" :key="grp.id">\n    <h3>{{ grp.title }}</h3>\n    <ul><li v-for="it in grp.items" :key="it.id">{{ it.label }}</li></ul>\n  </section>\n</nav>`,
      svelte: `<nav class="chunked-nav">\n  {#each groups as grp}\n    <section>\n      <h3>{grp.title}</h3>\n      <ul>{#each grp.items as it}<li>{it.label}</li>{/each}</ul>\n    </section>\n  {/each}\n</nav>`,
      css: `.chunked-nav {\n  display: flex;\n  flex-direction: column;\n  gap: 1.5rem;\n}\n.chunked-nav > section {\n  display: flex;\n  flex-direction: column;\n  gap: 0.5rem;\n}`,
    },
  },
  "fitts-law": {
    description: "Reduce Fitts's Law Index of Difficulty by placing primary actions in predictable, high-surface zones.",
    snippets: {
      react: `<div className="sticky bottom-6 right-6 z-50">\n  <button className="w-full sm:w-auto px-8 py-4 text-base font-semibold bg-primary text-primary-foreground rounded-xl shadow-lg">Primary Action</button>\n</div>`,
      "react-native": `<Pressable style={{ position: 'absolute', bottom: 24, left: 16, right: 16, height: 56, borderRadius: 12, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' }}>\n  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Primary Action</Text>\n</Pressable>`,
      vue: `<div class="fitts-action-bar">\n  <button class="primary-cta">Primary Action</button>\n</div>\n<style scoped>\n.primary-cta { min-height: 48px; min-width: 200px; padding: 14px 28px; font-size: 1rem; border-radius: 12px; }\n</style>`,
      svelte: `<div class="fitts-action-bar">\n  <button class="primary-cta">Primary Action</button>\n</div>\n<style>\n  .primary-cta { min-height: 48px; min-width: 200px; padding: 14px 28px; font-size: 1rem; border-radius: 12px; }\n</style>`,
      css: `.primary-cta {\n  min-height: 48px;\n  min-width: 200px;\n  padding: 14px 28px;\n  font-size: 1rem;\n  font-weight: 600;\n  border-radius: 12px;\n}`,
    },
  },
  "hick-hyman": {
    description: "Mitigate Hick-Hyman decision latency by structuring unorganized choices with hierarchy and search filtering.",
    snippets: {
      react: `<Command>\n  <CommandInput placeholder="Search actions..." />\n  <CommandList>\n    <CommandGroup heading="Suggestions">\n      <CommandItem>Option A</CommandItem>\n    </CommandGroup>\n  </CommandList>\n</Command>`,
      "react-native": `<AutocompleteDropdown dataSet={categorizedItems} clearOnFocus={false} closeOnBlur={true} />`,
      vue: `<FilteredSelect :options="groupedOptions" :searchable="true" :max-visible="5" />`,
      svelte: `<FilteredSelect options={groupedOptions} searchable={true} maxVisible={5} />`,
      css: `.option-menu {\n  max-height: 320px;\n  overflow-y: auto;\n  display: grid;\n  gap: 0.5rem;\n}`,
    },
  },
  "norman-grace": {
    description: "Provide Don Norman undo grace period, confirmation dialog, or reversible workflow for destructive action.",
    snippets: {
      react: `<Button variant="destructive" onClick={() => toast("Item removed", { action: { label: "Undo", onClick: () => handleRestore() } })}>Delete</Button>`,
      "react-native": `<Pressable onPress={() => Alert.alert('Delete Record', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: handleDelete }])}><Text>Delete</Text></Pressable>`,
      vue: `<ConfirmDialog @confirm="handleDelete" title="Confirm Delete" description="You have 5 seconds to undo.">\n  <button class="btn-destructive">Delete</button>\n</ConfirmDialog>`,
      svelte: `<button class="btn-destructive" on:click={promptConfirmation}>Delete</button>`,
      css: `.btn-destructive {\n  background-color: var(--destructive, #ef4444);\n  color: #ffffff;\n  transition: opacity 0.15s ease;\n}`,
    },
  },
  "ui-states-fsm": {
    description: "Implement complete 5-state FSM: default, hover, active/pressed, focus-visible, and disabled/loading.",
    snippets: {
      react: `<button className="px-4 py-2 rounded-md bg-blue-600 text-white transition-colors hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none">Interactive Button</button>`,
      "react-native": `<Pressable style={({ pressed, hovered, focused }) => [styles.btn, hovered && styles.hover, pressed && styles.press, focused && styles.focus]} disabled={disabled}>\n  <Text style={styles.btnText}>Interactive Button</Text>\n</Pressable>`,
      vue: `<button class="fsm-button" :disabled="isLoading">Interactive Button</button>\n<style scoped>\n.fsm-button { transition: all 0.15s ease; }\n.fsm-button:hover { filter: brightness(1.1); }\n.fsm-button:active { transform: scale(0.98); }\n.fsm-button:focus-visible { outline: 2px solid var(--ring); }\n.fsm-button:disabled { opacity: 0.5; pointer-events: none; }\n</style>`,
      svelte: `<button class="fsm-button" disabled={isLoading}>Interactive Button</button>\n<style>\n  .fsm-button:hover { filter: brightness(1.1); }\n  .fsm-button:active { transform: scale(0.98); }\n  .fsm-button:focus-visible { outline: 2px solid var(--ring); }\n  .fsm-button:disabled { opacity: 0.5; pointer-events: none; }\n</style>`,
      css: `.fsm-button {\n  transition: all 0.15s ease;\n}\n.fsm-button:hover { filter: brightness(1.1); }\n.fsm-button:active { transform: scale(0.98); }\n.fsm-button:focus-visible { outline: 2px solid var(--ring); }\n.fsm-button:disabled { opacity: 0.5; pointer-events: none; }`,
    },
  },
  "aria-focus-trap": {
    description: "Ensure modals & composite widgets implement WAI-ARIA 1.2 focus traps, modal flags, and roving tabindex.",
    snippets: {
      react: `<Dialog.Root>\n  <Dialog.Portal>\n    <Dialog.Overlay className="fixed inset-0 bg-black/50" />\n    <Dialog.Content role="dialog" aria-modal="true" className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-6 bg-white rounded-lg shadow-xl">\n      <Dialog.Title>Modal Title</Dialog.Title>\n    </Dialog.Content>\n  </Dialog.Portal>\n</Dialog.Root>`,
      "react-native": `<Modal visible={isOpen} accessibilityViewIsModal={true} focusable={true} onRequestClose={onClose}>\n  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>\n    <Text>Modal Title</Text>\n  </View>\n</Modal>`,
      vue: `<RadixDialog :trap-focus="true" aria-modal="true" role="dialog">\n  <h2>Modal Title</h2>\n</RadixDialog>`,
      svelte: `<div use:focusTrap role="dialog" aria-modal="true" class="modal-dialog">\n  <h2>Modal Title</h2>\n</div>`,
      css: `[role="dialog"][aria-modal="true"] {\n  position: fixed;\n  inset: 0;\n  z-index: 50;\n  display: grid;\n  place-items: center;\n}`,
    },
  },
  "floating-ui-collision": {
    description: "Apply Floating UI collision detection with flip, shift, and boundary padding (>= 8px).",
    snippets: {
      react: `<Popover.Content sideOffset={5} collisionPadding={8} avoidCollisions={true} className="z-50 rounded-md border bg-popover p-4 shadow-md">\n  Popover Content\n</Popover.Content>`,
      "react-native": `<FloatingTooltip boundaryPadding={8} flip={true} shift={true}>\n  <Text>Tooltip</Text>\n</FloatingTooltip>`,
      vue: `<Popper :middleware="[flip(), shift({ padding: 8 })]" class="floating-popover">\n  Popover Content\n</Popper>`,
      svelte: `<FloatingPlacement middleware={[flip(), shift({ padding: 8 })]}>\n  Popover Content\n</FloatingPlacement>`,
      css: `.floating-popover {\n  position: fixed;\n  max-width: calc(100vw - 16px);\n  max-height: calc(100vh - 16px);\n  overflow: auto;\n  z-index: 50;\n}`,
    },
  },
  "md3-state-layers": {
    description: "Apply Material Design 3 state layers: Hover (8%), Focus (12%), Pressed (12%), Dragged (16%).",
    snippets: {
      react: `<div className="relative overflow-hidden before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] focus-visible:before:opacity-[0.12] active:before:opacity-[0.12] before:transition-opacity">\n  MD3 Component\n</div>`,
      "react-native": `<Pressable style={({ pressed, hovered }) => [{ backgroundColor: '#6750A4' }, hovered && { opacity: 0.92 }, pressed && { opacity: 0.88 }]}>\n  <Text>MD3 Button</Text>\n</Pressable>`,
      vue: `<div class="md3-state-layer">MD3 Component</div>\n<style scoped>\n.md3-state-layer { position: relative; overflow: hidden; }\n.md3-state-layer:hover::before { opacity: 0.08; }\n.md3-state-layer:focus-visible::before { opacity: 0.12; }\n.md3-state-layer:active::before { opacity: 0.12; }\n</style>`,
      svelte: `<div class="md3-state-layer">MD3 Component</div>\n<style>\n  .md3-state-layer { position: relative; overflow: hidden; }\n  .md3-state-layer:hover::before { opacity: 0.08; }\n  .md3-state-layer:focus-visible::before { opacity: 0.12; }\n  .md3-state-layer:active::before { opacity: 0.12; }\n</style>`,
      css: `.md3-state-layer::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: currentColor;\n  opacity: 0;\n  transition: opacity 15ms linear;\n}\n.md3-state-layer:hover::before { opacity: 0.08; }\n.md3-state-layer:focus-visible::before { opacity: 0.12; }\n.md3-state-layer:active::before { opacity: 0.12; }`,
    },
  },
  "apple-hig-tracking": {
    description: "Align letter-spacing with Apple HIG optical tracking curves for SF Pro typography scaling.",
    snippets: {
      react: `<p className="font-sans antialiased text-[17px] tracking-[-0.41px] leading-[22px]">Apple HIG Typography</p>`,
      "react-native": `<Text style={{ fontSize: 17, letterSpacing: -0.41, lineHeight: 22 }}>Apple HIG Typography</Text>`,
      vue: `<p class="apple-hig-text">Apple HIG Typography</p>\n<style scoped>\n.apple-hig-text { font-size: 17px; letter-spacing: -0.41px; line-height: 22px; }\n</style>`,
      svelte: `<p class="apple-hig-text">Apple HIG Typography</p>\n<style>\n  .apple-hig-text { font-size: 17px; letter-spacing: -0.41px; line-height: 22px; }\n</style>`,
      css: `.apple-hig-body {\n  font-size: 17px;\n  letter-spacing: -0.41px;\n  line-height: 22px;\n  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;\n}`,
    },
  },
  "geist-tokens": {
    description: "Standardize token scales using Vercel Geist design tokens (Geist font, 6px/8px radii, 1px borders).",
    snippets: {
      react: `<div className="font-sans text-sm rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black p-4 shadow-sm">\n  Geist Card\n</div>`,
      "react-native": `<View style={{ borderRadius: 6, borderWidth: 1, borderColor: '#eaeaea', padding: 16, backgroundColor: '#ffffff' }}>\n  <Text>Geist Card</Text>\n</View>`,
      vue: `<div class="geist-card">Geist Card</div>\n<style scoped>\n.geist-card { font-family: var(--font-geist-sans); border-radius: 6px; border: 1px solid #eaeaea; padding: 16px; }\n</style>`,
      svelte: `<div class="geist-card">Geist Card</div>\n<style>\n  .geist-card { font-family: var(--font-geist-sans); border-radius: 6px; border: 1px solid #eaeaea; padding: 16px; }\n</style>`,
      css: `.geist-card {\n  font-family: var(--font-geist-sans, ui-sans-serif, system-ui);\n  border-radius: 6px;\n  border: 1px solid var(--accents-2, #eaeaea);\n  background: var(--geist-background, #ffffff);\n  padding: 16px;\n}`,
    },
  },
  "sidebar-layout": {
    description: "Configure standard vertical sidebar layout with zero top navbar and compliant anchor positions.",
    snippets: {
      react: `<div className="flex min-h-screen">\n  <aside className="w-64 border-r flex flex-col justify-between p-4 bg-sidebar">\n    <Logo />\n    <NavLinks />\n    <UserProfile />\n  </aside>\n  <main className="flex-1 p-6">Main Content</main>\n</div>`,
      "react-native": `<View style={{ flexDirection: 'row', flex: 1 }}>\n  <View style={{ width: 256, borderRightWidth: 1, padding: 16 }}>\n    <Text>Sidebar</Text>\n  </View>\n  <View style={{ flex: 1, padding: 16 }}>\n    <Text>Main Content</Text>\n  </View>\n</View>`,
      vue: `<div class="layout-container">\n  <aside class="sidebar"><Logo /><NavLinks /><UserProfile /></aside>\n  <main>Main Content</main>\n</div>`,
      svelte: `<div class="layout-container">\n  <aside class="sidebar"><Logo /><NavLinks /><UserProfile /></aside>\n  <main>Main Content</main>\n</div>`,
      css: `.layout-container {\n  display: grid;\n  grid-template-columns: 260px 1fr;\n  min-height: 100vh;\n}\n.sidebar {\n  display: flex;\n  flex-direction: column;\n  justify-content: space-between;\n  border-right: 1px solid var(--border);\n  padding: 1rem;\n}`,
    },
  },
};

export function generateRemediations(category: string): readonly CodeRemediation[] {
  const template = REMEDIATION_TEMPLATES[category];
  const frameworks: readonly CodeRemediationFramework[] = ["react", "react-native", "vue", "svelte", "css"];

  if (!template) {
    return frameworks.map((framework) => ({
      framework,
      description: `Remediate defect in category: ${category}`,
      snippet: `/* Fix for ${category} in ${framework} */`,
    }));
  }

  return frameworks.map((framework) => ({
    framework,
    description: template.description,
    snippet: template.snippets[framework],
  }));
}
