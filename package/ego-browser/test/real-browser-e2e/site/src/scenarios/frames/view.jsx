export default function FramesSurface() {
  return (
    <section class="surface checkout-layout">
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
      </div>
      <div class="partner-checkout">
        <div class="partner-heading">
          <span>SECURE PARTNER</span>
          <strong>Complete checkout</strong>
          <i>Protected frame</i>
        </div>
        <iframe
          id="test-frame"
          title="Browser test frame"
          src="/frames/content"
        />
      </div>
    </section>
  );
}
