# Backend Setup Instructions

This guide provides instructions on how to set up and run the Vinzons DigiPath backend server.

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)
- **PostgreSQL** (running locally or remotely)

## 1. Installation

First, navigate to the `backend` directory and install the project dependencies:

```bash
cd backend
npm install
```

## 2. Environment Configuration

Create a `.env` file by copying the provided example:

```bash
cp .env.example .env
```

Open the `.env` file and configure the environment variables as needed. Some important variables to check:

- `DATABASE_URL`: Connection string for your PostgreSQL database (e.g., `postgresql://postgres:postgres@127.0.0.1:5432/vinzons_digipath`).
- `PORT`: Port on which the server will run (default is 5000).
- `JWT_SECRET`: A secure random string for JWT token signing.
- `DEVICE_API_KEY`: Key used for IoT/Device authentication.

## 3. Database Setup

Once your PostgreSQL database is running and the `DATABASE_URL` is set, you need to set up your database schema.

**Run Migrations:**
Initialize the database tables:
```bash
npm run migrate
```

**(Optional) Seed the Database:**
To populate the database with initial dummy or required data, you can run the seed script:
```bash
npm run seed
```

## 4. Running the Server

### Development Mode
To run the server in development mode with auto-reloading (using nodemon):

```bash
npm run dev
```

### Production Mode
To run the server in production mode:

```bash
npm start
```

## Available Scripts

Here is a quick overview of the scripts available in `package.json`:

- `npm run dev` - Starts the development server with `nodemon`.
- `npm start` - Starts the standard Node server.
- `npm run migrate` - Runs PostgreSQL migrations.
- `npm run seed` - Runs the database seeder script.
- `npm run export-db` - Exports the PostgreSQL database to JSON.
- `npm run smoke` - Runs the workflow smoke tests.
- `npm run audit:roles` - Audits role-based access control.
