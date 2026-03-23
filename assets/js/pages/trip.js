(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
})((function () { 'use strict';

  /* -------------------------------------------------------------------------- */

  /* --------------------------------- Colors --------------------------------- */

  const getColor = (name, dom = document.documentElement) => {
    return getComputedStyle(dom).getPropertyValue(`--phoenix-${name}`).trim();
  };

  /* Mapbox cluster demo removed (unused; no tokens in repo). */
  const mapboxClusterInit = () => {};

  // import * as echarts from 'echarts';
  const { merge } = window._;

  // form config.js
  const echartSetOption = (
    chart,
    userOptions,
    getDefaultOptions,
    responsiveOptions
  ) => {
    const { breakpoints, resize } = window.phoenix.utils;
    const handleResize = options => {
      Object.keys(options).forEach(item => {
        if (window.innerWidth > breakpoints[item]) {
          chart.setOption(options[item]);
        }
      });
    };

    const themeController = document.body;
    // Merge user options with lodash
    chart.setOption(merge(getDefaultOptions(), userOptions));

    const navbarVerticalToggle = document.querySelector(
      '.navbar-vertical-toggle'
    );
    if (navbarVerticalToggle) {
      navbarVerticalToggle.addEventListener('navbar.vertical.toggle', () => {
        chart.resize();
        if (responsiveOptions) {
          handleResize(responsiveOptions);
        }
      });
    }

    resize(() => {
      chart.resize();
      if (responsiveOptions) {
        handleResize(responsiveOptions);
      }
    });
    if (responsiveOptions) {
      handleResize(responsiveOptions);
    }

    themeController.addEventListener(
      'clickControl',
      ({ detail: { control } }) => {
        if (control === 'phoenixTheme') {
          chart.setOption(window._.merge(getDefaultOptions(), userOptions));
        }
        if (responsiveOptions) {
          handleResize(responsiveOptions);
        }
      }
    );
  };
  // -------------------end config.js--------------------

  const echartTabs = document.querySelectorAll('[data-tab-has-echarts]');
  if (echartTabs) {
    echartTabs.forEach(tab => {
      tab.addEventListener('shown.bs.tab', e => {
        const el = e.target;
        const { hash } = el;
        const id = hash || el.dataset.bsTarget;
        const content = document.getElementById(id.substring(1));
        const chart = content?.querySelector('[data-echart-tab]');
        if (chart) {
          window.echarts.init(chart).resize();
        }
      });
    });
  }

  const handleTooltipPosition = ([pos, , dom, , size]) => {
    // only for mobile device
    if (window.innerWidth <= 540) {
      const tooltipHeight = dom.offsetHeight;
      const obj = { top: pos[1] - tooltipHeight - 20 };
      obj[pos[0] < size.viewSize[0] / 2 ? 'left' : 'right'] = 5;
      return obj;
    }
    return null; // else default behaviour
  };

  /* -------------------------------------------------------------------------- */
  /*                             Echarts trip review                            */
  /* -------------------------------------------------------------------------- */

  const { echarts } = window;

  const tripReviewChartInit = () => {
    const { getData, getColor } = window.phoenix.utils;
    const $echartTripReviews = document.querySelectorAll('.echart-trip-review');

    if ($echartTripReviews) {
      $echartTripReviews.forEach($echartTripReview => {
        const userOptions = getData($echartTripReview, 'options');
        const chart = echarts.init($echartTripReview);

        const getDefaultOptions = () => ({
          tooltip: {
            trigger: 'item',
            padding: [7, 10],
            backgroundColor: getColor('body-highlight-bg'),
            borderColor: getColor('border-color'),
            textStyle: { color: getColor('light-text-emphasis') },
            borderWidth: 1,
            position: (...params) => handleTooltipPosition(params),
            transitionDuration: 0,
            formatter: params => {
              return `<strong>${params.seriesName}:</strong> ${params.value}%`;
            },
            extraCssText: 'z-index: 1000'
          },
          series: [
            {
              type: 'gauge',
              name: 'Commission',
              startAngle: 90,
              endAngle: -270,
              radius: '90%',
              pointer: {
                show: false
              },
              progress: {
                show: true,
                overlap: false,
                // roundCap: true,
                clip: false,
                itemStyle: {
                  color: getColor('primary')
                }
              },
              axisLine: {
                lineStyle: {
                  width: 4,
                  color: [[1, getColor('secondary-bg')]]
                }
              },
              splitLine: {
                show: false
              },
              axisTick: {
                show: false
              },
              axisLabel: {
                show: false
              },
              detail: {
                fontSize: '20px',
                color: getColor('body-color'),
                offsetCenter: [0, '10%']
              }
            }
          ]
        });

        echartSetOption(chart, userOptions, getDefaultOptions);
      });
    }
  };

  const { docReady } = window.phoenix.utils;

  docReady(tripReviewChartInit);
  docReady(mapboxClusterInit);

}));
//# sourceMappingURL=trip.js.map
