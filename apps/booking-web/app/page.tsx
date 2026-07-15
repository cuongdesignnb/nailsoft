export default function Home() {
  return (
    <main className="booking-shell">
      <header className="brand">
        <strong>NAILSOFT</strong>
        <a href="/manage-booking">Quản lý lịch hẹn</a>
      </header>
      <section className="hero">
        <p>ĐẶT LỊCH TRỰC TUYẾN</p>
        <h1>Thời gian làm đẹp dành riêng cho bạn.</h1>
        <p className="muted">
          Xem giờ trống không cần tài khoản. Giá, múi giờ và chính sách được
          hiển thị trước khi xác nhận.
        </p>
        <a className="primary" href="/book/nailsoft-demo">
          Bắt đầu đặt lịch
        </a>
      </section>
    </main>
  );
}
