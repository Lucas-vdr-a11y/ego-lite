export default function DragDropSurface() {
  return (
    <section class="surface board-surface">
      <div class="board-toolbar">
        <div>
          <span>WEBSITE REFRESH</span>
          <strong>Sprint 24 · Design review</strong>
        </div>
        <div>
          <span class="avatar-stack">AM&nbsp;&nbsp;JW&nbsp;&nbsp;+2</span>
          <button class="quiet-action">Board settings</button>
        </div>
      </div>
      <div class="kanban-board">
        <section class="board-column">
          <header>
            <strong>IN PROGRESS</strong>
            <span>2</span>
          </header>
          <article id="mouse-drag-source" class="task-card">
            <span class="task-tag">COPY</span>
            <strong>Rewrite checkout reassurance</strong>
            <p>Clarify delivery dates at the final step.</p>
            <footer>
              <i>AM</i>
              <small>Today</small>
            </footer>
          </article>
          <article class="task-card quiet-card">
            <span class="task-tag">UI</span>
            <strong>Empty cart treatment</strong>
            <p>Prepare responsive states.</p>
          </article>
        </section>
        <section id="mouse-drag-target" class="board-column review-column">
          <header>
            <strong>REVIEW</strong>
            <span>1</span>
          </header>
          <article class="task-card">
            <span class="task-tag">A11Y</span>
            <strong>Keyboard order audit</strong>
            <p>Ready for product review.</p>
          </article>
          <output class="column-status" data-testid="mouse-drag-status">
            Drop pressed-pointer card here
          </output>
        </section>
        <section class="board-column">
          <header>
            <strong>READY</strong>
            <span>1</span>
          </header>
          <article
            id="html-drag-source"
            class="task-card priority-card"
            draggable="true"
          >
            <span class="task-tag">PRIORITY</span>
            <strong>Publish shipping matrix</strong>
            <p>Native draggable card with release payload.</p>
            <footer>
              <i>JW</i>
              <small>Drag me</small>
            </footer>
          </article>
          <div id="html-drop-target" class="native-drop-zone">
            Move ready work here
          </div>
          <output class="column-status" data-testid="html-drop-status">
            Awaiting release card
          </output>
        </section>
      </div>
    </section>
  );
}
