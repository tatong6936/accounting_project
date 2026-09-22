import cds from '@sap/cds';

if (process.env.VCAP_SERVICES) {
    const vcap = JSON.parse(process.env.VCAP_SERVICES);
    const pgSvc = Object.values(vcap).flat()
        .find(s => s.credentials && (s.credentials.hostname || s.credentials.host));
    if (pgSvc) {
        const c = pgSvc.credentials;
        cds.env.requires ??= {};
        cds.env.requires.db ??= {};
        cds.env.requires.db.credentials = {
            host: c.hostname || c.host,
            port: parseInt(c.port) || 5432,
            user: c.username || c.user,
            password: c.password,
            database: c.dbname || c.database,
            ssl: { rejectUnauthorized: false }
        };
        console.log(`[server.js] PostgreSQL credentials injected from VCAP_SERVICES (${cds.env.requires.db.credentials.host}:${cds.env.requires.db.credentials.port})`);
    }
}

export default cds.server;
