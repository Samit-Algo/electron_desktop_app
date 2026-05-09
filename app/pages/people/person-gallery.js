import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
'use strict';

function getEls() {
  return {
    loadingEl: document.getElementById('person-gallery-loading'),
    emptyEl: document.getElementById('person-gallery-empty'),
    gridEl: document.getElementById('person-gallery-grid'),
    detailViewEl: document.getElementById('person-detail-view'),
    detailBackBtn: document.getElementById('person-detail-back'),
    detailNameEl: document.getElementById('person-detail-name'),
    detailMetaEl: document.getElementById('person-detail-meta'),
    detailImagesEl: document.getElementById('person-detail-images'),
    detailImagesLoadingEl: document.getElementById('person-detail-images-loading'),
  };
}

function showState(els, loading, empty, grid, detailView) {
  if (els.loadingEl) els.loadingEl.classList.toggle('d-none', !loading);
  if (els.emptyEl) els.emptyEl.classList.toggle('d-none', !empty);
  if (els.gridEl) els.gridEl.classList.toggle('d-none', !grid);
  if (els.detailViewEl) els.detailViewEl.classList.toggle('d-none', !detailView);
}

async function loadMainPhotoUrl(personId, index) {
  index = index === undefined ? 0 : index;
  if (!api || typeof api.fetchPersonImageObjectUrl !== 'function') return null;
  try { return await api.fetchPersonImageObjectUrl(personId, index); }
  catch (e) { return null; }
}

async function renderGallery() {
  const els = getEls();
  if (!els.gridEl) return;
  showState(els, true, false, false, false);
  if (!api || typeof api.getPersonGalleryList !== 'function') {
    showState(els, false, true, false, false);
    return;
  }
  try {
    const people = await api.getPersonGalleryList();
    if (!Array.isArray(people) || people.length === 0) { showState(els, false, true, false, false); return; }
    const sorted = people.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    els.gridEl.innerHTML = '';

    for (const person of sorted) {
      const col = document.createElement('div');
      col.className = 'col-sm-6 col-md-4 col-lg-3';
      const card = document.createElement('div');
      card.className = 'card h-100 shadow-sm border border-translucent';
      card.style.cursor = 'pointer';
      card.setAttribute('data-person-id', person.id);
      card.setAttribute('data-person-name', person.name || '');
      card.setAttribute('data-person-count', String(person.image_count || 0));

      const imgWrap = document.createElement('div');
      imgWrap.className = 'card-img-top position-relative bg-body-secondary';
      imgWrap.style.height = '180px';
      imgWrap.style.overflow = 'hidden';
      const img = document.createElement('img');
      img.className = 'w-100 h-100';
      img.alt = person.name || 'Person';
      img.style.objectFit = 'cover';
      imgWrap.appendChild(img);

      const cardBody = document.createElement('div');
      cardBody.className = 'card-body py-3';
      const nameEl = document.createElement('h6');
      nameEl.className = 'card-title mb-1 text-body-emphasis';
      nameEl.textContent = person.name || '(unnamed)';
      const meta = document.createElement('p');
      meta.className = 'mb-0 small text-body-tertiary';
      meta.textContent = (person.image_count || 0) + ' photo(s)';
      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge ' + (person.status === 'active' ? 'bg-success' : 'bg-warning text-dark') + ' mt-1';
      statusBadge.textContent = person.status === 'active' ? 'Active' : 'Incomplete';
      cardBody.appendChild(nameEl);
      cardBody.appendChild(meta);
      cardBody.appendChild(statusBadge);
      card.appendChild(imgWrap);
      card.appendChild(cardBody);
      col.appendChild(card);
      els.gridEl.appendChild(col);

      (async function () {
        const url = await loadMainPhotoUrl(person.id, 0);
        if (url) img.src = url;
        else { img.style.background = 'var(--phoenix-body-secondary)'; img.alt = 'No photo'; }
      })();

      card.addEventListener('click', function () { openPersonDetail(person); });
    }
    showState(els, false, false, true, false);
  } catch (err) {
    console.error('Person gallery load error:', err);
    showState(els, false, true, false, false);
  }
}

async function openPersonDetail(person) {
  const els = getEls();
  if (!els.detailViewEl || !els.detailNameEl || !els.detailMetaEl || !els.detailImagesEl) return;
  els.detailNameEl.textContent = person.name || '(unnamed)';
  els.detailMetaEl.textContent = (person.image_count || 0) + ' photo(s) • ' + (person.status === 'active' ? 'Active' : 'Incomplete');
  els.detailImagesEl.innerHTML = '';
  els.detailImagesEl.classList.add('d-none');
  els.detailImagesLoadingEl.classList.remove('d-none');
  showState(els, false, false, false, true);

  const count = Math.max(0, parseInt(person.image_count, 10) || 0);
  if (count === 0) {
    els.detailImagesLoadingEl.classList.add('d-none');
    els.detailImagesEl.classList.remove('d-none');
    els.detailImagesEl.innerHTML = '<div class="col-12"><p class="text-body-tertiary small mb-0">No images for this person.</p></div>';
    return;
  }

  for (let i = 0; i < count; i++) {
    const col = document.createElement('div');
    col.className = 'col-sm-6 col-md-4 col-lg-3';
    const card = document.createElement('div');
    card.className = 'card h-100 shadow-sm border border-translucent';
    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-img-top position-relative bg-body-secondary';
    imgWrap.style.height = '180px';
    imgWrap.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.className = 'w-100 h-100';
    img.style.objectFit = 'cover';
    img.alt = (person.name || 'Person') + ' photo ' + (i + 1);
    imgWrap.appendChild(img);
    const cardBody = document.createElement('div');
    cardBody.className = 'card-body py-2';
    const label = document.createElement('p');
    label.className = 'mb-0 small text-body-tertiary';
    label.textContent = 'Photo ' + (i + 1);
    cardBody.appendChild(label);
    card.appendChild(imgWrap);
    card.appendChild(cardBody);
    col.appendChild(card);
    els.detailImagesEl.appendChild(col);

    (async function (idx) {
      try {
        if (api && typeof api.fetchPersonImageObjectUrl === 'function') {
          img.src = await api.fetchPersonImageObjectUrl(person.id, idx);
        }
      } catch (e) { img.alt = 'Failed to load'; }
    })(i);
  }

  els.detailImagesLoadingEl.classList.add('d-none');
  els.detailImagesEl.classList.remove('d-none');
}

function initFindPersonModal() {
  const findPersonBtn = document.getElementById('chatbot-find-person-btn');
  const modalEl = document.getElementById('find-person-modal');
  const formEl = document.getElementById('find-person-form');
  const nameInput = document.getElementById('find-person-name');
  const existingSelect = document.getElementById('find-person-existing');
  const fileInput = document.getElementById('find-person-file');
  const submitBtn = document.getElementById('find-person-submit-btn');
  if (!findPersonBtn || !modalEl || !formEl || !submitBtn) return;

  let galleryLoaded = false;
  async function loadPersonGalleryIntoSelect() {
    if (!existingSelect || !api || typeof api.getPersonGalleryList !== 'function') return;
    if (galleryLoaded && existingSelect.options.length > 1) return;
    existingSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a person from the list (optional)';
    existingSelect.appendChild(placeholder);
    try {
      const people = await api.getPersonGalleryList();
      if (!Array.isArray(people) || people.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No persons found in gallery yet';
        existingSelect.appendChild(opt);
        return;
      }
      people.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach(function (person) {
        const opt = document.createElement('option');
        opt.value = person.name || '';
        opt.textContent = person.name || '(unnamed)';
        existingSelect.appendChild(opt);
      });
      galleryLoaded = true;
    } catch (err) {
      if (toast && typeof toast.error === 'function') toast.error(err.message || 'Failed to load person list.');
    }
  }

  findPersonBtn.addEventListener('click', function () {
    if (typeof bootstrap === 'undefined') return;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
    if (nameInput) nameInput.value = '';
    if (fileInput) fileInput.value = '';
    if (existingSelect) existingSelect.value = '';
    loadPersonGalleryIntoSelect();
  });

  if (existingSelect) {
    existingSelect.addEventListener('change', function () {
      const selectedName = existingSelect.value || '';
      if (selectedName && nameInput) nameInput.value = selectedName;
    });
  }

  submitBtn.addEventListener('click', function () {
    var name = nameInput ? nameInput.value.trim() : '';
    var files = fileInput && fileInput.files ? fileInput.files : [];
    if (!name) {
      if (toast && toast.warning) toast.warning('Please enter the person\'s name.');
      else alert('Please enter the person\'s name.');
      if (nameInput) nameInput.focus();
      return;
    }
    if (files.length < 4) {
      if (toast && toast.warning) toast.warning('Please select at least 4 photos for accurate recognition.');
      else alert('Please select at least 4 photos.');
      if (fileInput) fileInput.focus();
      return;
    }
    if (!api) {
      if (toast && toast.error) toast.error('API service not available.');
      else alert('API service not available.');
      return;
    }
    var btnText = submitBtn.querySelector('.find-person-btn-text');
    var spinner = submitBtn.querySelector('.find-person-spinner');
    if (btnText) btnText.classList.add('d-none');
    if (spinner) spinner.classList.remove('d-none');
    submitBtn.disabled = true;

    api.uploadReferencePhotos(name, files)
      .then(function (res) {
        const count = res.image_count || files.length;
        if (toast && toast.success) toast.success(count + ' photos uploaded for ' + name + '. You can now create an agent like "alert me when ' + name + ' appears on camera 1".');
        else alert('Uploaded ' + count + ' photos for ' + name);
        if (typeof bootstrap !== 'undefined') { var mi = bootstrap.Modal.getInstance(modalEl); if (mi) mi.hide(); }
        if (formEl) formEl.reset();
        renderGallery();
      })
      .catch(function (err) {
        if (toast && toast.error) toast.error(err.message || 'Upload failed.');
        else alert(err.message || 'Upload failed.');
      })
      .finally(function () {
        if (btnText) btnText.classList.remove('d-none');
        if (spinner) spinner.classList.add('d-none');
        submitBtn.disabled = false;
      });
  });
}

function initDetailBack() {
  const detailBackBtn = document.getElementById('person-detail-back');
  if (detailBackBtn) {
    detailBackBtn.addEventListener('click', function () {
      const els = getEls();
      showState(els, false, false, true, false);
    });
  }
}

export async function boot() {
  initDetailBack();
  initFindPersonModal();
  await renderGallery();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { boot(); });
} else {
  boot();
}
