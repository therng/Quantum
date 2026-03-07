## Packages
recharts | For plot curves and sparklines
date-fns | For formatting timestamps
clsx | For conditional class joining
tailwind-merge | For conditional class joining
lucide-react | For professional icons

## Notes
The application is styled as a "dark mode professional" trading dashboard.
It assumes the backend will return a 404 if a terminal is not found.
Curves are fetched per-terminal for the sparklines, which may result in multiple API calls on the dashboard. In a production environment, you might want to paginate or bundle these, but for a compact dashboard, it works well.
