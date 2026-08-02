export default function FramesSurface() {
  return (
    <section class="surface card checkout-layout">
      <div class="order-summary">
        <span>ORDER / EG-1842</span>
        <h2>Arc desk set</h2>
        <div class="order-visual">
          <i>ARC</i>
        </div>
        <dl>
          <div>
            <dt>Finish</dt>
            <dd>Burnt clay</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>2–4 business days</dd>
          </div>
          <div>
            <dt>Subtotal</dt>
            <dd>S$ 248.00</dd>
          </div>
        </dl>
        <p>Secure partner checkout appears alongside the host order context.</p>
        <output
          class="d-block mt-3 alert alert-light border small"
          data-testid="host-frame-status"
          role="status"
        >
          Waiting for partner confirmation
        </output>
      </div>
      <div class="partner-checkout">
        <div class="partner-heading">
          <span>SECURE PARTNER</span>
          <strong>Complete checkout</strong>
          <i>Protected frame</i>
        </div>
        <div id="frame-slot" class="frame-slot">
          <p class="text-secondary small mb-3">
            Load the partner surface when you are ready to enter payment
            details.
          </p>
          <button id="load-frame" type="button" class="btn btn-primary">
            Load secure checkout
          </button>
        </div>
      </div>
    </section>
  );
}
