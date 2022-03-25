class LoadObserver {
  constructor(object) {
    this.finishTime = null;
    this.load = new Promise((resolve, reject) => {
      object.onload = ev => {
        this.finishTime = ev.timeStamp;
        resolve(ev);
      };
      object.onerror = reject;
    });
  }

  get finished() {
    return this.finishTime !== null;
  }
}

function createAutofocusTarget() {
  const autofocusTarget = document.createElement('textarea');
  autofocusTarget.setAttribute('autofocus', '');
  // We may not have a body element at this point if we are testing a
  // script-blocking stylesheet. Hence, the new element is added to
  // documentElement.
  document.documentElement.appendChild(autofocusTarget);
  return autofocusTarget;
}

function createScrollTarget() {
  const scrollTarget = document.createElement('div');
  scrollTarget.style.overflow = 'scroll';
  scrollTarget.style.height = '100px';
  const scrollContent = document.createElement('div');
  scrollContent.style.height = '200px';
  scrollTarget.appendChild(scrollContent);
  document.documentElement.appendChild(scrollTarget);
  scrollTarget.scrollTop = 100;
  return scrollTarget;
}

function createAnimationTarget() {
  const style = document.createElement('style');
  style.textContent = `
      @keyframes anim {
        from { height: 100px; }
        to { height: 200px; }
      }
  `;
  const animationTarget = document.createElement('div');
  animationTarget.style.backgroundColor = 'green';
  animationTarget.style.height = '50px';
  animationTarget.style.animation = 'anim 100ms';
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(animationTarget);
  return animationTarget;
}

// Error margin for comparing timestamps of paint and load events, in case they
// are reported by different threads.
const epsilon = 50;

function test_render_blocking(optional_element, finalTest, finalTestTitle) {
  // Ideally, we should observe the 'load' event on the specific render-blocking
  // elements. However, this is not possible for script-blocking stylesheets, so
  // we have to observe the 'load' event on 'window' instead.
  if (!(optional_element instanceof HTMLElement)) {
    finalTestTitle = finalTest;
    finalTest = optional_element;
    optional_element = undefined;
  }
  const loadObserver = new LoadObserver(optional_element || window);

  promise_test(async test => {
    assert_implements(window.PerformancePaintTiming);

    await test.step_wait(() => performance.getEntriesByType('paint').length);

    assert_true(loadObserver.finished);
    for (let entry of performance.getEntriesByType('paint')) {
      assert_greater_than(entry.startTime, loadObserver.finishTime - epsilon,
                          `${entry.name} should occur after loading render-blocking resources`);
    }
  }, 'Rendering is blocked before render-blocking resources are loaded');

  promise_test(test => {
    return loadObserver.load.then(() => finalTest(test));
  }, finalTestTitle);
}

// Returns a Promise that rejects if certain events on `target` fire before
// the Promise `condition` fulfills.
function rejectIfEventsFired(condition, target, events) {
  if (!Array.isArray(events))
    events = [events];
  return new Promise((resolve, reject) => {
    for (let eventName of events) {
      target.addEventListener(eventName,
          () => reject(`'${eventName}' event is dispatched`));
    }
    condition.then(resolve);
  });
}

// Tests that certain steps of Update the rendering [1] are not reached when
// the document is render-blocked and hence has no rendering opportunities.
// [1] https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering
function test_render_blocked_apis(optional_element, finalTest, finalTestTitle) {
  // Ideally, we should observe the 'load' event on the specific render-blocking
  // elements. However, this is not possible for script-blocking stylesheets, so
  // we have to observe the 'load' event on 'window' instead.
  if (!(optional_element instanceof HTMLElement)) {
    finalTestTitle = finalTest;
    finalTest = optional_element;
    optional_element = undefined;
  }
  const loadObserver = new LoadObserver(optional_element || window);

  function test_event_blocked(target, events, title) {
    const promise = rejectIfEventsFired(loadObserver.load, target, events);
    promise_test(() => promise, title);
  }

  test_event_blocked(
      createAutofocusTarget(), 'focus',
      'Should not flush autofocus candidates when render-blocked');

  test_event_blocked(
      createScrollTarget(), 'scroll',
      'Should not run the scroll steps when render-blocked');

  test_event_blocked(
      createAnimationTarget(), ['animationstart', 'animationend'],
      'Should not run the update animations and send events steps when render-blocked');

  // We should also verify that the context lost steps for canvas are not run,
  // but there's currently no way to reliably trigger a context lost in WPT.
  // See https://github.com/web-platform-tests/wpt/issues/30039

  const raf = new Promise((resolve, reject) => {
    requestAnimationFrame(() => reject('Animation frame callback is run'));
    loadObserver.load.then(resolve);
  });
  promise_test(
      () => raf,
      'Should not run animation frame callbacks when render-blocked');

  const intersection = new Promise((resolve, reject) => {
    new IntersectionObserver(() => reject('IntersectionObserver callback is run'))
        .observe(document.documentElement);
    loadObserver.load.then(resolve);
  });
  promise_test(
      () => intersection,
      'Should not run the update intersection observers step when render-blocked');

  promise_test(test => {
    return loadObserver.load.then(() => finalTest(test));
  }, finalTestTitle);
}
