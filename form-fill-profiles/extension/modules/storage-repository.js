// storage-repository.js — CRUD over chrome.storage.local for forms, profiles and
// settings. Loaded in extension pages and in the service worker. Spec §8, §10.

if (typeof Store === 'undefined') {
  var Store = (() => {
    const DEFAULT_SETTINGS = {
      showApplyResult: true,
      includePasswordFields: false,
      includeHiddenFields: false,
      dispatchEvents: true,
      retryDynamicForms: true,
      retryWindowMs: 3000,
    };

    function now() {
      return new Date().toISOString();
    }

    function newId(prefix) {
      return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }

    async function read() {
      const data = await chrome.storage.local.get(['forms', 'profiles', 'settings']);
      return {
        forms: data.forms || [],
        profiles: data.profiles || [],
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      };
    }

    // ─── Settings ──────────────────────────────────────────────────────────────

    async function getSettings() {
      const { settings } = await read();
      return settings;
    }

    async function saveSettings(patch) {
      const settings = { ...(await getSettings()), ...patch };
      await chrome.storage.local.set({ settings });
      return settings;
    }

    // ─── Forms ─────────────────────────────────────────────────────────────────

    async function getForms() {
      const { forms } = await read();
      return forms;
    }

    async function getForm(formId) {
      const forms = await getForms();
      return forms.find((form) => form.id === formId) || null;
    }

    async function writeForms(forms) {
      await chrome.storage.local.set({ forms });
    }

    // Turn a scanner snapshot into a stored form record. Spec §8.1.
    async function createForm(snapshot, url) {
      const forms = await getForms();
      const parsed = new URL(url);
      const timestamp = now();

      const form = {
        id: newId('form'),
        formKey: snapshot.formKey,
        signature: snapshot.signature,
        label: snapshot.formLabel,
        domainPattern: FormMatcher.suggestDomainPattern(parsed.hostname),
        pathPattern: FormMatcher.normalizePath(parsed.pathname),
        sourceUrl: url,
        hostname: parsed.hostname,
        containerSelector: snapshot.containerSelector,
        isOrphan: !!snapshot.isOrphan,
        enabled: true,
        defaultProfileId: null,
        schemaChanged: false,
        fields: snapshot.fields,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: null,
      };

      forms.push(form);
      await writeForms(forms);
      return form;
    }

    async function updateForm(formId, patch) {
      const forms = await getForms();
      const index = forms.findIndex((form) => form.id === formId);
      if (index === -1) return null;
      forms[index] = { ...forms[index], ...patch, id: formId, updatedAt: now() };
      await writeForms(forms);
      return forms[index];
    }

    async function deleteForm(formId) {
      const { forms, profiles } = await read();
      await chrome.storage.local.set({
        forms: forms.filter((form) => form.id !== formId),
        profiles: profiles.filter((profile) => profile.formId !== formId),
      });
    }

    // Merge a fresh snapshot into an existing form, keeping fieldIds so saved
    // answers survive. Spec §13.5.
    async function recaptureForm(formId, snapshot) {
      const form = await getForm(formId);
      if (!form) return null;

      const oldFields = form.fields || [];
      const used = new Set();
      const summary = { unchanged: 0, updated: 0, added: [], removed: [] };

      const findOld = (field) =>
        oldFields.find((old) => !used.has(old.fieldId) && old.name && field.name && old.name === field.name) ||
        oldFields.find((old) => !used.has(old.fieldId) && old.id && field.id && old.id === field.id) ||
        oldFields.find((old) => !used.has(old.fieldId) && old.labelText === field.labelText && old.kind === field.kind) ||
        oldFields.find((old) => !used.has(old.fieldId) && old.kind === field.kind && old.domIndex === field.domIndex);

      const merged = snapshot.fields.map((field) => {
        const old = findOld(field);
        if (!old) {
          summary.added.push(field.labelText);
          return field;
        }
        used.add(old.fieldId);
        if (old.selector === field.selector) summary.unchanged++;
        else summary.updated++;
        return { ...field, fieldId: old.fieldId };
      });

      // Fields no longer on the page stay in the record so their saved answers
      // are not silently dropped; apply skips them.
      for (const old of oldFields) {
        if (used.has(old.fieldId)) continue;
        summary.removed.push(old.labelText);
        merged.push({ ...old, removed: true });
      }

      const updated = await updateForm(formId, {
        fields: merged,
        formKey: snapshot.formKey,
        signature: snapshot.signature,
        containerSelector: snapshot.containerSelector,
        sourceUrl: snapshot.sourceUrl,
        schemaChanged: summary.added.length > 0 || summary.removed.length > 0,
      });

      return { form: updated, summary };
    }

    // ─── Profiles ──────────────────────────────────────────────────────────────

    async function getProfiles(formId) {
      const { profiles } = await read();
      if (!formId) return profiles;
      return profiles.filter((profile) => profile.formId === formId);
    }

    async function getProfile(profileId) {
      const { profiles } = await read();
      return profiles.find((profile) => profile.id === profileId) || null;
    }

    async function writeProfiles(profiles) {
      await chrome.storage.local.set({ profiles });
    }

    async function createProfile(formId, data) {
      const { profiles } = await read();
      const timestamp = now();
      const profile = {
        id: newId('profile'),
        formId,
        name: data.name || 'Untitled profile',
        note: data.note || '',
        values: data.values || {},
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: null,
        useCount: 0,
      };
      profiles.push(profile);
      await writeProfiles(profiles);
      if (data.isDefault) await updateForm(formId, { defaultProfileId: profile.id });
      return profile;
    }

    async function updateProfile(profileId, patch) {
      const { profiles } = await read();
      const index = profiles.findIndex((profile) => profile.id === profileId);
      if (index === -1) return null;
      profiles[index] = { ...profiles[index], ...patch, id: profileId, updatedAt: now() };
      await writeProfiles(profiles);
      return profiles[index];
    }

    async function deleteProfile(profileId) {
      const { profiles, forms } = await read();
      const profile = profiles.find((item) => item.id === profileId);
      await writeProfiles(profiles.filter((item) => item.id !== profileId));
      if (profile) {
        const form = forms.find((item) => item.id === profile.formId);
        if (form?.defaultProfileId === profileId) await updateForm(form.id, { defaultProfileId: null });
      }
    }

    async function duplicateProfile(profileId) {
      const profile = await getProfile(profileId);
      if (!profile) return null;
      return createProfile(profile.formId, {
        name: `${profile.name} (copy)`,
        note: profile.note,
        values: { ...profile.values },
      });
    }

    async function setDefaultProfile(formId, profileId) {
      return updateForm(formId, { defaultProfileId: profileId });
    }

    // Usage stats after a successful apply.
    async function touchProfile(profileId) {
      const profile = await getProfile(profileId);
      if (!profile) return;
      const timestamp = now();
      await updateProfile(profileId, { lastUsedAt: timestamp, useCount: (profile.useCount || 0) + 1 });
      await updateForm(profile.formId, { lastUsedAt: timestamp });
    }

    // ─── Export / import ───────────────────────────────────────────────────────

    async function exportData(formIds) {
      const { forms, profiles } = await read();
      const selected = formIds?.length ? forms.filter((form) => formIds.includes(form.id)) : forms;
      const ids = new Set(selected.map((form) => form.id));
      return {
        version: '1',
        exportedAt: now(),
        forms: selected,
        profiles: profiles.filter((profile) => ids.has(profile.formId)),
      };
    }

    function validateImport(payload) {
      if (!payload || typeof payload !== 'object') return 'File is not a valid JSON object';
      if (payload.version !== '1') return `Unsupported version: ${payload.version}`;
      if (!Array.isArray(payload.forms) || !Array.isArray(payload.profiles)) return 'Missing "forms" or "profiles" array';
      for (const form of payload.forms) {
        if (!form.id || !form.domainPattern || !Array.isArray(form.fields)) return 'A form record is malformed';
      }
      for (const profile of payload.profiles) {
        if (!profile.id || !profile.formId) return 'A profile record is malformed';
      }
      return null;
    }

    // strategy: 'skip' | 'merge' | 'replace' for forms that already exist
    // (same formKey + domainPattern + pathPattern). Spec §14.2.
    async function importData(payload, strategy = 'merge') {
      const error = validateImport(payload);
      if (error) return { success: false, error };

      const { forms, profiles } = await read();
      const nextForms = [...forms];
      const nextProfiles = [...profiles];
      const stats = { formsAdded: 0, formsMerged: 0, formsSkipped: 0, formsReplaced: 0, profilesAdded: 0 };

      const sameForm = (a, b) => a.formKey === b.formKey && a.domainPattern === b.domainPattern && (a.pathPattern || '') === (b.pathPattern || '');

      for (const incoming of payload.forms) {
        const incomingProfiles = payload.profiles.filter((profile) => profile.formId === incoming.id);
        const existing = nextForms.find((form) => sameForm(form, incoming));

        if (existing && strategy === 'skip') {
          stats.formsSkipped++;
          continue;
        }

        if (existing && strategy === 'merge') {
          for (const profile of incomingProfiles) {
            nextProfiles.push({ ...profile, id: newId('profile'), formId: existing.id });
            stats.profilesAdded++;
          }
          stats.formsMerged++;
          continue;
        }

        if (existing && strategy === 'replace') {
          const index = nextForms.indexOf(existing);
          const formId = existing.id;
          nextForms[index] = { ...incoming, id: formId, defaultProfileId: null };
          for (let i = nextProfiles.length - 1; i >= 0; i--) {
            if (nextProfiles[i].formId === formId) nextProfiles.splice(i, 1);
          }
          for (const profile of incomingProfiles) {
            nextProfiles.push({ ...profile, id: newId('profile'), formId });
            stats.profilesAdded++;
          }
          stats.formsReplaced++;
          continue;
        }

        // New form — regenerate ids but keep the form/profile relationship.
        const formId = newId('form');
        const defaultProfileMap = new Map();
        for (const profile of incomingProfiles) {
          const profileId = newId('profile');
          defaultProfileMap.set(profile.id, profileId);
          nextProfiles.push({ ...profile, id: profileId, formId });
          stats.profilesAdded++;
        }
        nextForms.push({
          ...incoming,
          id: formId,
          defaultProfileId: defaultProfileMap.get(incoming.defaultProfileId) || null,
        });
        stats.formsAdded++;
      }

      await chrome.storage.local.set({ forms: nextForms, profiles: nextProfiles });
      return { success: true, stats };
    }

    async function clearAll() {
      await chrome.storage.local.set({ forms: [], profiles: [] });
    }

    return {
      DEFAULT_SETTINGS,
      read,
      getSettings,
      saveSettings,
      getForms,
      getForm,
      createForm,
      updateForm,
      deleteForm,
      recaptureForm,
      getProfiles,
      getProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      duplicateProfile,
      setDefaultProfile,
      touchProfile,
      exportData,
      validateImport,
      importData,
      clearAll,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.Store = Store;
}
