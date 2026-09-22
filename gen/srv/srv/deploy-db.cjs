'use strict';
const cds = require('@sap/cds');
const { Pool } = require('pg');

const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
const pgSvc = Object.values(vcap).flat().find(s => s.credentials && (s.credentials.hostname || s.credentials.host));

if (!pgSvc) {
    console.error('No PostgreSQL service found in VCAP_SERVICES');
    process.exit(1);
}

const c = pgSvc.credentials;
const connConfig = {
    host: c.hostname || c.host,
    port: c.port || 5432,
    user: c.username || c.user,
    password: c.password,
    database: c.dbname || c.database,
    ssl: { rejectUnauthorized: false }
};

console.log(`Deploying to ${connConfig.host}:${connConfig.port}...`);

function toPostgresSQL(sql) {
    return sql
        .replace(/\bNVARCHAR\((\d+)\)/gi, 'VARCHAR($1)')
        .replace(/\bNVARCHAR\b/gi, 'TEXT')
        .replace(/\bTIMESTAMP_TEXT\b/gi, 'TIMESTAMP')
        .replace(/\bTIME_TEXT\b/gi, 'TIME')
        .replace(/\bDATE_TEXT\b/gi, 'DATE')
        .replace(/\bREAL_DECIMAL\((\d+),\s*(\d+)\)/gi, 'DECIMAL($1,$2)')
        .replace(/\bREAL_DECIMAL\b/gi, 'DECIMAL')
        .replace(/\bSMALLDECIMAL\b/gi, 'NUMERIC')
        .replace(/\bNBINARY\((\d+)\)/gi, 'BYTEA')
        .replace(/\bNBINARY\b/gi, 'BYTEA')
        .replace(/\bVARBINARY\((\d+)\)/gi, 'BYTEA')
        .replace(/\bVARBINARY\b/gi, 'BYTEA')
        .replace(/\bBINARY_FLOAT\b/gi, 'REAL')
        .replace(/\bBINARY_DOUBLE\b/gi, 'DOUBLE PRECISION')
        .replace(/\bNDOUBLE\b/gi, 'DOUBLE PRECISION')
        .replace(/\bNFLOAT\b/gi, 'REAL')
        .replace(/\bNBLOB\b/gi, 'BYTEA')
        .replace(/\bNCLOB\b/gi, 'TEXT')
        .replace(/\bNLONGSTRING\b/gi, 'TEXT')
        .replace(/\bBLOB\b/gi, 'BYTEA')
        .replace(/\bCLOB\b/gi, 'TEXT')
        .replace(/\bCREATE TABLE (?!IF)/gi, 'CREATE TABLE IF NOT EXISTS ');
}

async function deploy() {
    const pool = new Pool(connConfig);
    try {
        // Drop any tables not belonging to our app
        const { rows } = await pool.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              AND table_name NOT LIKE 'com_hospital_accounting%'
        `);

        for (const { table_name } of rows) {
            console.log(`Dropping: ${table_name}`);
            await pool.query(`DROP TABLE IF EXISTS "${table_name}" CASCADE`);
        }

        // Load model and generate DDL with PostgreSQL types
        const model = await cds.load('srv/csn.json');
        const sqlStatements = cds.compile.to.sql(model);

        let count = 0;
        for (const stmt of sqlStatements) {
            const pgStmt = toPostgresSQL(stmt);
            await pool.query(pgStmt);
            count++;
        }

        console.log(`Created ${count} database objects.`);
        console.log('Schema deployed successfully!');
    } finally {
        await pool.end();
    }
}

deploy()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Deploy failed:', err);
        process.exit(1);
    });
