function splitList(s) {
  return (s || '').split(',').map(x => x.trim()).filter(Boolean);
}

export const config = {
  dashboardUrl: process.env.DASHBOARD_URL || 'https://v3-dashboard-production.up.railway.app',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',

  teamPassword: process.env.TEAM_PASSWORD || 'change-me',

  allowedOrigins: splitList(process.env.ALLOWED_ORIGINS) || ['*'],

  // Emmi's BOL Report — single scope. If more reports are added later, extend this.
  recipients: {
    bol: {
      to: splitList(process.env.BOL_TO) || [
        'charlie@globalv3logistics.com',
        'brad@globalv3logistics.com',
        'xavier1240@globalv3logistics.com',
      ],
      cc: splitList(process.env.BOL_CC) || [
        'nick.le@sentrystrategy.com',
      ],
      // Subject like "BOL Report - May 22" — short month name + day.
      subject: (date) => {
        const d = new Date(date);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `BOL Report - ${months[d.getMonth()]} ${d.getDate()}`;
      },
    },
  },

  from: process.env.MAIL_FROM || 'Emmi Le <vananh.le@sentryxp.com>',
};
