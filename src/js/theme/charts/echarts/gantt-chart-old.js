/* -------------------------------------------------------------------------- */
/*                             Gantt Chart                               */
/* -------------------------------------------------------------------------- */

/* ---------------------- Initialize Gantt Data ----------------------------- */
const Selectors = {
  DATA_GANTT_SEARCH: '[data-gantt-search]',
  DATA_GANTT_SEARCH_DISMISS: '[data-gantt-search-dismiss]',
  DATA_GANTT_VIEW: '[data-gantt-view]',
  DATA_DELETE_LINK_MODAL: '#dataDeleteLinkModal',
  DATA_GANTT_ZOOM: 'data-gantt-zoom',
  DATA_GANTT_ADD_TASK: '[data-gantt-add-task]',
  DATA_GANTT_ADD_SUBTASK: '[data-gantt-add-subtask]',
  TASK_DETAILS_OFFCANVAS: '#taskDetailsOffcanvas',
  TASK_DETAILS_NAME: '#taskDetailsName',
  TASK_DETAILS_START_DATE: '#taskDetailsStartDate',
  TASK_DETAILS_END_DATE: '#taskDetailsEndDate',
  TASK_DETAILS_DURATION: '#taskDetailsDuration',
  GANTT_ADD_TASK_MODAL: '#ganttAddTaskModal',
  CREATE_TASK_NAME: 'createTaskName',
  CREATE_TASK_START_DATE: 'createTaskStartDate',
  CREATE_TASK_DURATION: 'createTaskDuration',
  CREATE_NEW_TASK: '#createNewTask',
  GANTT_UPDATE_TASK: 'ganttUpdateTask',
  GANTT_DELETE_TASK: '#ganttDeleteTask',
  GANTT_CONFIRM_DELETE_TASK: '#ganttConfirmDeleteTask',
  GANTT_DELETE_TASK_MODAL: '#ganttDeleteTaskModal',
  GANTT_DELETE_LINK_MODAL: '#ganttDeleteLinkModal',
  GANTT_DELETE_LINK_BTN: '#ganttDeleteLinkBtn',
  GANTT_ZOOM_TO_FIT: '#ganttZoomToFit'
};

const Views = {
  DAYS: 'days',
  WEEKS: 'weeks',
  MONTHS: 'months',
  YEARS: 'years'
};
const Events = {
  ON_TASK_DBL_CLICK: 'onTaskDblClick',
  ON_TASK_CREATED: 'onTaskCreated',
  ON_LINK_DBL_CLICK: 'onLinkDblClick',
  CLICK: 'click',
  SHOWN_BS_MODAL: 'shown.bs.modal',
  HIDDEN_BS_OFFCANVAS: 'hidden.bs.offcanvas',
  INPUT: 'input',
  ON_BEFORE_TASK_DISPLAY: 'onBeforeTaskDisplay'
};

const { gantt } = window;

const weekScaleTemplate = date => {
  const dateToStr = gantt.date.date_to_str('%M %d');
  const endDate = gantt.date.add(date, 7 - date.getDay(), 'day');
  return `${dateToStr(date)} - ${dateToStr(endDate)}`;
};

const scales = {
  days: [{ unit: 'day', step: 1, format: '%d %M' }],
  weeks: [
    { unit: 'month', step: 1, format: '%F' },
    { unit: 'week', step: 1, format: weekScaleTemplate }
  ],
  months: [
    { unit: 'year', step: 1, format: '%Y' },
    { unit: 'month', step: 1, format: '%F' }
  ],
  years: [
    {
      unit: 'year',
      step: 3,
      format(date) {
        const dateToStr = gantt.date.date_to_str('%Y');
        const endDate = gantt.date.add(date, 3, 'year');
        return `${dateToStr(date)} - ${dateToStr(endDate)}`;
      }
    },
    { unit: 'year', step: 1, format: '%Y' }
  ]
};

const initializeGanttData = () => {
  gantt.parse({
    tasks: [
      {
        id: 11,
        text: 'Travel agency landing page design',
        type: 'project',
        progress: 0.6,
        open: true,
        priority: 'Urgent',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          }
        ]
      },
      {
        id: 12,
        text: 'Task #1',
        start_date: '03-04-2023',
        duration: 25,
        parent: 11,
        progress: 1,
        open: true,
        priority: 'High',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          }
        ]
      },
      {
        id: 13,
        text: 'Task #2',
        start_date: '03-04-2023',
        type: 'project',
        parent: 11,
        progress: 0.5,
        open: true,
        priority: 'Medium',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 14,
        text: 'Task #3',
        start_date: '02-06-2023',
        duration: 20,
        parent: 11,
        progress: 0.8,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          }
        ]
      },
      {
        id: 15,
        text: 'Task #4',
        type: 'project',
        parent: 11,
        progress: 0.2,
        open: true,
        priority: 'Low',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 16,
        text: 'Final milestone',
        start_date: '15-04-2023',
        duration: 3,
        type: 'milestone',
        parent: 11,
        progress: 0,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 17,
        text: 'Task #2.1',
        start_date: '03-04-2023',
        duration: 22,
        parent: 13,
        progress: 1,
        open: true,
        priority: 'Low',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Milind Mikuja',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 18,
        text: 'Task #2.2',
        start_date: '06-04-2023',
        duration: 14,
        parent: 13,
        progress: 0.8,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 19,
        text: 'Task #2.3',
        start_date: '10-04-2023',
        duration: 4,
        parent: 13,
        progress: 0.2,
        open: true,
        priority: 'Urgent',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 20,
        text: 'Task #2.4',
        start_date: '10-04-2023',
        duration: 6,
        parent: 13,
        progress: 0,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Milind Mikuja',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 21,
        text: 'Task #4.1',
        start_date: '03-04-2023',
        duration: 4,
        parent: 15,
        progress: 0.5,
        open: true,
        priority: 'Urgent',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          },
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Milind Mikuja',
            img: '/team/30.webp'
          },
          {
            name: 'Josef Stravinsky',
            img: '/team/60.webp'
          }
        ]
      },
      {
        id: 22,
        text: 'Task #4.2',
        start_date: '03-04-2023',
        duration: 5,
        parent: 15,
        progress: 0.1,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 23,
        text: 'Mediate milestone',
        start_date: '14-04-2023',
        duration: 5,
        type: 'milestone',
        parent: 15,
        progress: 0,
        open: true,
        priority: 'medium',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 24,
        text: 'New Module 2',
        start_date: '03-08-2023',
        duration: 25,
        progress: 1,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 25,
        text: 'New Module 3',
        start_date: '04-04-2023',
        duration: 5,
        progress: 0,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 26,
        text: 'New Module 4',
        start_date: '05-04-2023',
        duration: 5,
        progress: 0,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 27,
        text: 'New Module 5',
        start_date: '06-04-2023',
        duration: 5,
        progress: 0,
        open: true,
        priority: 'medium',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 28,
        text: 'New Module 6',
        start_date: '07-04-2023',
        duration: 5,
        progress: 0,
        open: true,
        priority: 'high',
        assignee: [
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      },
      {
        id: 29,
        text: 'New Module 7',
        start_date: '08-04-2023',
        duration: 5,
        progress: 0,
        open: true,
        priority: 'low',
        assignee: [
          {
            name: 'John',
            img: '/team/33.webp'
          },
          {
            name: 'Adam',
            img: '/team/30.webp'
          }
        ]
      }
    ],
    links: [
      { id: 10, source: 11, target: 12, type: 1 },
      { id: 11, source: 11, target: 13, type: 1 },
      { id: 12, source: 11, target: 14, type: 1 },
      { id: 13, source: 11, target: 15, type: 1 },
      { id: 14, source: 23, target: 16, type: 0 },
      { id: 15, source: 13, target: 17, type: 1 },
      { id: 16, source: 17, target: 18, type: 0 },
      { id: 17, source: 18, target: 19, type: 0 },
      { id: 18, source: 19, target: 20, type: 0 },
      { id: 19, source: 15, target: 21, type: 2 },
      { id: 20, source: 15, target: 22, type: 2 },
      { id: 21, source: 15, target: 23, type: 0 }
    ]
  });
};

const formatDate = date =>
  new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

/* ----------Search Handler----------------------*/
const searchHandler = () => {
  let filterValue = '';
  const filterEl = document.querySelector(Selectors.DATA_GANTT_SEARCH);
  const searchDismissBtn = document.querySelector(
    Selectors.DATA_GANTT_SEARCH_DISMISS
  );
  searchDismissBtn?.addEventListener(Events.CLICK, () => {
    filterValue = '';
    filterEl.value = '';
    searchDismissBtn?.classList.remove('d-block');
    gantt.render();
  });

  filterEl?.addEventListener(Events.INPUT, () => {
    if (filterEl.value.length > 0) {
      searchDismissBtn?.classList.add('d-block');
    } else {
      searchDismissBtn?.classList.remove('d-block');
    }
    filterValue = filterEl.value;
    gantt.render();
  });

  const filterLogic = (task, match = false) => {
    gantt.eachTask(child => {
      if (filterLogic(child)) {
        match = true;
      }
    }, task.id);

    if (task.text.toLowerCase().includes(filterValue.toLowerCase())) {
      match = true;
    }

    return match;
  };

  gantt.attachEvent(Events.ON_BEFORE_TASK_DISPLAY, (id, task) => {
    if (!filterValue) {
      return true; // Show all tasks if no filter is applied
    }
    return filterLogic(task); // Filter tasks
  });
};
/*----------------------------------------------------------------------
                Link Delete Handler                                     
 ------------------------------------------------------------------------*/
const linkDeleteHandler = () => {
  let currentLinkId;
  const linkDeleteModalEl = document.querySelector(
    Selectors.GANTT_DELETE_LINK_MODAL
  );
  const linkDeleteModal = new window.bootstrap.Modal(linkDeleteModalEl);
  gantt.attachEvent(Events.ON_LINK_DBL_CLICK, id => {
    currentLinkId = id;
    linkDeleteModal.show();
    return false;
  });

  // Confirm deletion of the link
  const deleteLinkBtn = document.querySelector(Selectors.GANTT_DELETE_LINK_BTN);
  deleteLinkBtn.addEventListener(Events.CLICK, () => {
    if (currentLinkId) {
      gantt.deleteLink(currentLinkId);
    }
    linkDeleteModal.hide();
  });
};

/* ---------- Task Double-Click Handler ------------------------*/
let currentTaskId;
const taskDoubleClickHandler = () => {
  gantt.attachEvent(Events.ON_TASK_DBL_CLICK, id => {
    const task = gantt.getTask(id);
    currentTaskId = id;

    const offcanvasEl = document.querySelector(
      Selectors.TASK_DETAILS_OFFCANVAS
    );
    if (offcanvasEl) {
      const offcanvas = new window.bootstrap.Offcanvas(offcanvasEl);
      offcanvas.show();

      // update offcanvas taskname
      const taskNameEl = offcanvasEl.querySelector(Selectors.TASK_DETAILS_NAME);
      if (taskNameEl) taskNameEl.value = task.text;

      // update dates with flatpickr
      const ganttTaskStartPicker = window.flatpickr(
        Selectors.TASK_DETAILS_START_DATE,
        {
          dateFormat: 'M j, Y',
          disableMobile: true,
          defaultDate: 'Mar 1, 2022'
        }
      );
      const ganttTaskEndPicker = window.flatpickr(
        Selectors.TASK_DETAILS_END_DATE,
        {
          dateFormat: 'M j, Y',
          disableMobile: true,
          defaultDate: 'Mar 1, 2022'
        }
      );
      const taskStartDate = formatDate(task.start_date);
      const taskEndDate = formatDate(task.end_date);
      ganttTaskStartPicker.setDate(taskStartDate, true);
      ganttTaskEndPicker.setDate(taskEndDate, true);
      document.querySelector(Selectors.TASK_DETAILS_DURATION).value =
        task.duration;
    }

    return false; // Prevent default lightbox
  });
};

/*----------------------------------------------------------------------
                Task Update Handler                                     
 ------------------------------------------------------------------------*/
// on update task
const taskUpdateHandler = () => {
  document
    .getElementById(Selectors.GANTT_UPDATE_TASK)
    ?.addEventListener(Events.CLICK, () => {
      const offcanvasEl = document.querySelector(
        Selectors.TASK_DETAILS_OFFCANVAS
      );
      const updatedTaskName = offcanvasEl.querySelector(
        Selectors.TASK_DETAILS_NAME
      ).value;
      const task = gantt.getTask(currentTaskId);

      const updatedStartDate = new Date(
        document.querySelector(Selectors.TASK_DETAILS_START_DATE).value
      );

      const updatedDuration = document.querySelector(
        Selectors.TASK_DETAILS_DURATION
      ).value;

      const updatedEndDate = gantt.calculateEndDate({
        start_date: updatedStartDate,
        duration: updatedDuration,
        task: {}
      });

      if (
        updatedTaskName &&
        updatedStartDate &&
        updatedEndDate &&
        updatedDuration
      ) {
        task.text = updatedTaskName;
        task.start_date = updatedStartDate;
        task.duration = updatedDuration;
        task.end_date = updatedEndDate;
        gantt.updateTask(task.id, task);
        const offcanvasInstance =
          window.bootstrap.Offcanvas.getInstance(offcanvasEl);
        offcanvasInstance.hide();
      }
    });
};

/*----------------------------------------------------------------------
                Task delete Handler                                     
 ------------------------------------------------------------------------*/
const taskDeleteHandler = () => {
  const ganttDeleteTask = document.querySelector(Selectors.GANTT_DELETE_TASK);

  if (ganttDeleteTask) {
    let triggerDeleteModal = false; // Flag to determine whether to show the modal

    ganttDeleteTask.addEventListener('click', () => {
      triggerDeleteModal = true;
      const offcanvasEl = document.querySelector(
        Selectors.TASK_DETAILS_OFFCANVAS
      );

      const offcanvasInstance =
        window.bootstrap.Offcanvas.getInstance(offcanvasEl);

      offcanvasInstance.hide();
      const modalEl = document.querySelector(Selectors.GANTT_DELETE_TASK_MODAL);
      console.log(modalEl);

      const modal = new window.bootstrap.Modal(modalEl);
      offcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
        if (triggerDeleteModal) {
          if (modalEl) {
            modal.show();
          }
          triggerDeleteModal = false;
        }
      });
      modalEl.addEventListener(Events.SHOWN_BS_MODAL, () => {
        const confirmDeleteTaskBtn = document.querySelector(
          Selectors.GANTT_CONFIRM_DELETE_TASK
        );
        if (confirmDeleteTaskBtn) {
          confirmDeleteTaskBtn.addEventListener(Events.CLICK, () => {
            if (currentTaskId) {
              gantt.deleteTask(currentTaskId);
              modal.hide();
            }
          });
        }
      });
    });
  }
};

/* ------------Task Create Handler ----------------------*/
const taskCreateHandler = () => {
  gantt.attachEvent(Events.ON_TASK_CREATED, task => {
    const modalEl = document.querySelector(Selectors.GANTT_ADD_TASK_MODAL);
    const modal = new window.bootstrap.Modal(modalEl);
    modal.show();
    document.getElementById(Selectors.CREATE_TASK_NAME).value = task.text || '';
    document.querySelector(Selectors.CREATE_NEW_TASK).onclick = () => {
      const taskName = document.getElementById(
        Selectors.CREATE_TASK_NAME
      ).value;
      const taskStart = new Date(
        document.getElementById(Selectors.CREATE_TASK_START_DATE).value
      );
      const duration =
        document.getElementById(Selectors.CREATE_TASK_DURATION).value || 2;
      const taskEnd = gantt.calculateEndDate({
        start_date: taskStart,
        duration,
        task: {}
      });
      if (taskName && taskStart && taskEnd) {
        task.text = taskName;
        task.start_date = taskStart;
        task.end_date = taskEnd;
        gantt.addTask(task);
        modal.hide();
      }
    };
    return false; // Prevent default task creation
  });
};

/* -------------Gantt view handler ----------------*/

const updateGanttView = label => {
  switch (label) {
    case Views.DAYS:
      gantt.config.scales = scales.days;
      break;
    case Views.WEEKS:
      gantt.config.scales = scales.weeks;
      break;
    case Views.MONTHS:
      gantt.config.scales = scales.months;
      break;
    case Views.YEARS:
      gantt.config.scales = scales.years;
      break;
    default:
      gantt.config.scales = scales.months;
      break;
  }
  gantt.render();
};

/* --------------Gantt chart init start --------------*/

const ganttChartInit = () => {
  const { getItemFromStore, breakpoints } = window.phoenix.utils;
  const ganttElement = document.querySelector('#gantt-app');
  if (!ganttElement) return;

  gantt.plugins({});
  gantt.config.scales = scales.days;
  gantt.config.row_height = 48; // Adjust task row height
  gantt.config.scale_height = 70;
  gantt.config.bar_height = 16;
  gantt.config.autosize = 'y';
  gantt.config.sort = true;
  gantt.config.grid_resizer = true;
  gantt.config.min_column_width = 130; // Increase the minimum width of each cell

  // custom columns
  gantt.config.columns = [
    {
      name: 'text',
      label: 'PROJECT NAME',
      tree: true,
      width: 330,
      min_width: 80,
      template(task) {
        // const subTasks = gantt.getChildren(task.id).length;
        return `<div class='gantt-task-title-wrapper'> 
          <span class='gantt-task-title'>${task.text}</span>
          <button  data-gantt-add-subtask id=${task.id} class='btn btn-subtle-info  gantt-task-title-btn'><span class='fa-solid fa-plus'/></button>
        </div>`;
      }
    },
    {
      name: 'Priority',
      label: 'PRIORITY',
      width: 120,
      min_width: 50,
      template(task) {
        const label = task.priority?.toLowerCase();
        let color;
        switch (label) {
          case 'urgent':
            color = 'danger';
            break;
          case 'high':
            color = 'warning';
            break;
          case 'medium':
            color = 'info';
            break;
          default:
            color = 'secondary';
            break;
        }
        return `<span class="badge badge-phoenix badge-phoenix-${color}">${
          task.priority || ''
        }</span>`;
      },
      sort(a, b) {
        const priorityA = a.priority.toLowerCase();
        const priorityB = b.priority.toLowerCase();

        if (priorityA < priorityB) return -1;
        if (priorityA > priorityB) return 1;
        return 0;
      }
    },
    {
      name: 'assignee',
      label: 'ASSIGNEE',
      width: 120,
      template(task) {
        if (task.type === gantt.config.types.project) {
          return '';
        }
        const path = '../assets/img/';
        const owners = task.assignee || [];

        if (!owners.length) {
          return 'Unassigned';
        }

        const items = owners
          .map((assignee, idx) => {
            if (owners.length > 3 && idx === 2) {
              return `
              <div class=''>
                <a href='#!' data-bs-toggle='dropdown' aria-expanded='false' data-bs-auto-close='outside'
                  class='dropdown-toggle dropdown-caret-none avatar avatar-s'>
                  <div class='avatar-name rounded-circle'>
                    <span>+${owners.length - 2}</span>
                  </div>
                </a>
                <ul class="dropdown-menu dropdown-menu-end py-0">
                  ${owners
                    .map(
                      owner =>
                        `<div class='dropdown-item py-0 px-3 d-flex gap-3 align-items-center'>
                          <div class='avatar avatar-m'>
                            <img class="rounded-circle" src="${path}${
                          owner.img
                        }" alt="${owner.name || 'assignee'}"
                              />
                          </div>
                          <a href="#" class='fw-bold text-body text-decoration-none'>${
                            owner.name
                          }</a>
                        </div>`
                    )
                    .join('')}
                </ul>
              </div>
              `;
            }

            if (idx <= 2) {
              return `<div class=''>
                 <div data-bs-toggle='dropdown' data-bs-auto-close='outside' class='avatar avatar-s dropdown-toggle dropdown-caret-none'>
                      <img class="rounded-circle" src="${path}${
                assignee.img
              }" alt="${assignee.name || 'assignee'}"
                        />
                </div>
                <ul class="dropdown-menu dropdown-menu-end py-0">
                  <div class='dropdown-item py-0 px-3 d-flex gap-3 align-items-center'>
                          <div class='avatar avatar-m'>
                            <img class="rounded-circle" src="${path}${
                assignee.img
              }" alt="${assignee.name || 'assignee'}"
                              />
                          </div>
                          <a href="#" class='fw-bold text-body text-decoration-none'>${
                            assignee.name
                          }</a>
                        </div>
                </ul>
              </div>`;
            }
          })
          .join('');
        const template = `<div class="d-flex align-items-center">${items}</div>`;
        return template;
      },
      sort: false
    },

    {
      name: 'start_date',
      label: 'START DATE',
      align: 'start',
      width: 150,
      template(task) {
        return `
         <span class='uil uil-calendar-alt text-body-quaternary fs-8 me-1'></span> ${formatDate(
           task.start_date
         )} 
      `;
      }
    },
    {
      name: 'end_date',
      label: 'END DATE',
      align: 'start',
      width: 150,
      template(task) {
        return `
       <span class='uil uil-calendar-alt text-body-quaternary fs-8 me-1'></span> ${formatDate(
         task.end_date
       )} 
    `;
      }
    },
    {
      name: 'duration',
      label: 'DURATION',
      align: 'start',
      width: 100,
      template(task) {
        return `
        <span class='uil uil-clock me-1 fs-8 text-quaternary'></span>
        ${task.duration} days 
    `;
      }
    }
  ];

  // ------ setup layout ----
  const gridConfig = {
    width: 550,
    rows: [
      {
        view: 'grid',
        scrollX: 'gridScroll',
        scrollable: true,
        scrollY: 'scrollVer'
      },
      { view: 'scrollbar', id: 'gridScroll' }
    ]
  };

  const timelineConfig = {
    rows: [
      { view: 'timeline', scrollX: 'scrollHor', scrollY: 'scrollVer' },
      { view: 'scrollbar', id: 'scrollHor' }
    ]
  };

  const scrollbarConfig = { view: 'scrollbar', id: 'scrollVer' };
  const resizerConfig = { resizer: true, width: 1 };

  gantt.config.layout = {
    css: 'gantt_container',
    cols: [gridConfig, resizerConfig, timelineConfig, scrollbarConfig]
  };

  // --------------- Rtl ----------------
  if (getItemFromStore('phoenixIsRTL')) {
    gantt.config.rtl = true;
    gantt.config.layout = {
      css: 'gantt_container',
      cols: [scrollbarConfig, timelineConfig, resizerConfig, gridConfig]
    };
  }
  gantt.init('gantt-app');
  initializeGanttData();

  // ---------- add a custom class to header ------------------
  gantt.templates.grid_header_class = columnName => {
    if (columnName === 'assignee') {
      return 'sort-btn-none';
    }
    return '';
  };

  // -------- gantt view control -------------
  let setCurrentView = Views.DAYS;

  const ganttViewEl = document.querySelector('[data-gantt-view]');
  ganttViewEl?.addEventListener('change', event => {
    if (document.querySelector(Selectors.GANTT_ZOOM_TO_FIT).checked) {
      document.querySelector(Selectors.GANTT_ZOOM_TO_FIT).checked = false;
    }
    setCurrentView = event.target.value;
    updateGanttView(event.target.value);
  });

  /*----------------------------------------------------------------------
                Click handler                                  
  ------------------------------------------------------------------------*/
  document.addEventListener(Events.CLICK, event => {
    const ganttZoomEl = event.target.hasAttribute(Selectors.DATA_GANTT_ZOOM)
      ? event.target
      : event.target.closest([Selectors.DATA_GANTT_ZOOM]);
    const ganttAddTaskEl = event.target.closest(Selectors.DATA_GANTT_ADD_TASK);
    const ganttAddSubtaskEl = event.target.closest(
      Selectors.DATA_GANTT_ADD_SUBTASK
    );

    if (ganttZoomEl) {
      let zoom;
      const isCheckBox = ganttZoomEl?.getAttribute('type') === 'checkbox';
      if (isCheckBox) {
        zoom = Views.MONTHS;
        const isChecked = ganttZoomEl.checked;
        updateGanttView(isChecked ? zoom : setCurrentView);
        document.querySelector('[data-gantt-view]').value = isChecked
          ? zoom
          : setCurrentView;
      } else {
        if (document.querySelector(Selectors.GANTT_ZOOM_TO_FIT).checked) {
          document.querySelector(Selectors.GANTT_ZOOM_TO_FIT).checked = false;
        }
        const zoomValue = ganttZoomEl.getAttribute(Selectors.DATA_GANTT_ZOOM);
        zoom = zoomValue === 'zoomIn' ? Views.DAYS : Views.MONTHS;
        updateGanttView(zoom);
      }
    }
    // --------- crete a new task/subtask when click on add btn --------
    if (ganttAddTaskEl) {
      gantt.createTask(
        {
          text: '',
          duration: 5
        },
        'project_2',
        1
      );
    } else if (ganttAddSubtaskEl) {
      gantt.createTask({
        text: '',
        duration: 3,
        parent: ganttAddSubtaskEl.getAttribute('id')
      });
    }
  });

  // gantt responsive
  const handleResize = () => {
    gantt.$root.style.width = '100%';
    const { cols } = gantt.config.layout;
    const gridBox = cols.find(item => item.rows?.[0]?.view === 'grid') || {};

    if (window.innerWidth <= breakpoints.sm) {
      gridBox.width = 150;
    } else if (window.innerWidth <= breakpoints.md) {
      gridBox.width = 230;
    } else if (window.innerWidth <= breakpoints.lg) {
      gridBox.width = 300;
    } else {
      gridBox.width = 550;
    }

    gantt.init('gantt-app');
  };
  handleResize();
  window.addEventListener('resize', handleResize);

  // Attach event handlers
  taskDoubleClickHandler();
  taskCreateHandler();
  taskUpdateHandler();
  taskDeleteHandler();
  linkDeleteHandler();
  searchHandler();
};

export default ganttChartInit;
