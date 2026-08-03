export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading operations dashboard" className="loading-screen">
      <div className="loading-sidebar" />
      <div className="loading-content">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-copy" />
        <div className="loading-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <span className="skeleton skeleton-card" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
