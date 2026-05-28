# Use an official Node.js runtime as a parent image
FROM node:20-alpine

LABEL organisation="fieldflicks-backend"
LABEL maintainer="fieldflicks"

# Set the working directory inside the container
WORKDIR /usr/src/app

# Add cache-busting argument
ARG CACHEBUST=1

# Build provenance — populated from GitHub Actions via --build-arg. These end
# up baked into the image as env vars and are surfaced by GET / so anyone can
# tell which commit + build time is actually live in ECS.
ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown
ARG BUILD_REF=unknown
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME
ENV BUILD_REF=$BUILD_REF

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
CMD ["npm", "run", "start:prodecs"]
