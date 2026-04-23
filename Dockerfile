# Use an official Node.js runtime as a parent image
FROM node:18-alpine

LABEL organisation="fieldflicks-backend"
LABEL maintainer="fieldflicks"

# Set the working directory inside the container
WORKDIR /usr/src/app

# Add cache-busting argument
ARG CACHEBUST=1

# Copy the package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the NestJS application
RUN npm run build

# Expose the application port
EXPOSE 8000

# Define the command to run the application
CMD ["npm", "run", "start:prod"]
