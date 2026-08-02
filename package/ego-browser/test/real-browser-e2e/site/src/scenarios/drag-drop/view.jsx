export default function DragDropSurface() {
  return (
    <section class="surface card board-surface">
      <div class="board-toolbar">
        <div>
          <span>WEBSITE REFRESH</span>
          <strong>Sprint 24 · Design review</strong>
        </div>
        <div>
          <span class="avatar-stack">AM&nbsp;&nbsp;JW&nbsp;&nbsp;+2</span>
          <button
            id="reset-board"
            type="button"
            class="btn btn-sm btn-outline-secondary ms-2"
          >
            Reset board
          </button>
        </div>
      </div>
      <div class="kanban-board">
        <section class="board-column">
          <header>
            <strong>IN PROGRESS</strong>
            <span data-testid="progress-count">2</span>
          </header>
          <div class="task-list" data-kanban-list data-column="progress">
            <article
              id="mouse-drag-source"
              class="task-card"
              data-column="progress"
              data-card-title="Checkout reassurance"
            >
              <div class="task-card-heading">
                <span class="task-tag">COPY</span>
                <button
                  type="button"
                  class="drag-handle"
                  data-drag-handle
                  aria-label="Drag checkout reassurance"
                  title="Drag card"
                  disabled
                >
                  ⋮⋮
                </button>
              </div>
              <strong>Rewrite checkout reassurance</strong>
              <p>Clarify delivery dates at the final step.</p>
              <footer>
                <i>AM</i>
                <small>Today</small>
              </footer>
              <button
                id="move-copy-review"
                type="button"
                class="btn btn-sm btn-outline-secondary mt-2"
              >
                Move checkout reassurance to review
              </button>
            </article>
            <article
              class="task-card quiet-card"
              data-column="progress"
              data-card-title="Empty cart treatment"
            >
              <div class="task-card-heading">
                <span class="task-tag">UI</span>
                <button
                  type="button"
                  class="drag-handle"
                  data-drag-handle
                  aria-label="Drag empty cart treatment"
                  title="Drag card"
                  disabled
                >
                  ⋮⋮
                </button>
              </div>
              <strong>Empty cart treatment</strong>
              <p>Prepare responsive states.</p>
            </article>
          </div>
        </section>
        <section class="board-column review-column">
          <header>
            <strong>REVIEW</strong>
            <span data-testid="review-count">1</span>
          </header>
          <div
            id="mouse-drag-target"
            class="task-list"
            data-kanban-list
            data-column="review"
          >
            <article
              class="task-card"
              data-column="review"
              data-card-title="Keyboard order audit"
            >
              <div class="task-card-heading">
                <span class="task-tag">A11Y</span>
                <button
                  type="button"
                  class="drag-handle"
                  data-drag-handle
                  aria-label="Drag keyboard order audit"
                  title="Drag card"
                  disabled
                >
                  ⋮⋮
                </button>
              </div>
              <strong>Keyboard order audit</strong>
              <p>Ready for product review.</p>
            </article>
          </div>
          <output class="column-status" data-testid="mouse-drag-status">
            Drag a card here by its handle
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
            data-column="ready"
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
          <span class="visually-hidden" data-testid="done-count">
            0
          </span>
          <output class="column-status" data-testid="html-drop-status">
            Awaiting release card
          </output>
        </section>
      </div>
    </section>
  );
}
