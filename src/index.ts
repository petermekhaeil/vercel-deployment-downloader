import fs from 'fs';
import { resolve } from 'path';
import fetch from 'node-fetch';
import prompts from 'prompts';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import type { AuthUser, Team, Deployment, FileTree } from './types';

dayjs.extend(relativeTime);

const getAccessToken = () => {
  const accessToken = process.env.VERCEL_ACCESS_TOKEN;

  if (!accessToken) {
    throw Error(
      [
        '🚨',
        'Vercel Access Tokens are required to authenticate and use the Vercel API.',
        'Please generate one and set it to the VERCEL_ACCESS_TOKEN environment variable.',
        'See: https://vercel.com/guides/how-do-i-use-a-vercel-api-access-token#creating-an-access-token',
        ''
      ].join('\n')
    );
  }

  return accessToken;
};

const getOutputDirectory = async () => {
  let outputDir = './output';

  await prompts([
    {
      type: 'text',
      name: 'outputDir',
      message: 'Output Directory',
      initial: outputDir,
      onState: (state) => {
        outputDir = state.value;
      }
    },
    {
      type: () => (!fs.existsSync(outputDir) ? null : 'confirm'),
      name: 'overwrite',
      message: () => `Target directory "${outputDir}" exists. Overwrite?`
    },
    {
      type: (_, { overwrite }: { overwrite?: boolean }) => {
        if (overwrite === false) {
          throw new Error('Exiting.');
        }
        return null;
      },
      name: 'overwriteChecker'
    }
  ]);

  return outputDir;
};

const getUser = async (accessToken: string) => {
  const response = await fetch('https://api.vercel.com/v2/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    method: 'get'
  });

  const { user }: { user: AuthUser } = await response.json();

  return user;
};

const getTeams = async (accessToken: string) => {
  const response = await fetch('https://vercel.com/api/v2/teams', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    method: 'get'
  });

  const { teams = [] }: { teams: Team[] } = await response.json();

  return teams;
};

const getDeployments = async (accessToken: string, teamId: string) => {
  const url =
    `https://api.vercel.com/v6/deployments` +
    (teamId ? `?teamId=${teamId}` : '');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    method: 'get'
  });

  const data: { deployments: Deployment[]; error?: Error } =
    await response.json();

  if (data.error) {
    throw Error(
      [
        '',
        'Error has occurred when attempting to download list of deployments.',
        data.error.message,
        'See https://vercel.com/docs/rest-api#errors/generic-errors',
        ''
      ].join('\n')
    );
  }

  return data.deployments;
};

const getDeploymentFiles = async (
  accessToken: string,
  teamId: string,
  deployment: Deployment
) => {
  const url =
    `https://api.vercel.com/v6/deployments/${deployment.uid}/files` +
    (teamId ? `?teamId=${teamId}` : '');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    method: 'get'
  });

  const data: FileTree[] | { error: Error } = await response.json();

  if ('error' in data) {
    throw Error(
      [
        '',
        'Error has occurred when attempting to download list of deployments.',
        data.error.message,
        'See https://vercel.com/docs/rest-api#errors/generic-errors',
        ''
      ].join('\n')
    );
  }

  return data;
};

const checkDeploymentSource = (deployment: Deployment) => {
  if (deployment.source === 'git') {
    log(['', 'The files of this deployment cannot be downloaded.'].join('\n'));

    const { meta } = deployment;
    if (meta && meta.githubCommitRepo) {
      const { githubCommitRepo, githubCommitOrg, githubCommitSha } = meta;
      const url = `https://github.com/${githubCommitOrg}/${githubCommitRepo}/tree/${githubCommitSha}`;

      log([`View Source on GitHub: ${url}`, ''].join('\n'));
    } else {
      log([`View Source on Vercel: ${deployment.inspectorUrl}`, ''].join('\n'));
    }
    process.exit(0);
  }
};

const log = (...args: any) => {
  console.log(...args);
};

const fileContentFetcher = (
  accessToken: string,
  teamId: string,
  deployment: Deployment
) => {
  return async function (file: FileTree) {
    const url =
      `https://api.vercel.com/v6/deployments/${deployment.uid}/files/${file.uid}` +
      (teamId ? `?teamId=${teamId}` : '');

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      method: 'get'
    });

    return response;
  };
};

const downloadFile = async (
  entry: FileTree,
  path: string,
  fetcher: Function
) => {
  const downloadPath = resolve(path, entry.name);

  // There are some encounters in testing where some files named
  // the same as directories. We will skip them until I understand why.
  if (fs.existsSync(downloadPath) && fs.lstatSync(downloadPath).isDirectory()) {
    return;
  }

  log(`Downloading: ${path}/${entry.name}`);

  try {
    const data = await fetcher(entry);

    return new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(downloadPath);
      data.body.pipe(dest);
      data.body.on('end', () => resolve(downloadPath));
      dest.on('error', reject);
    });
  } catch (e) {
    console.error(e);
  }
};

const parseFileTreeEntry = async (
  entry: FileTree,
  path: string,
  fetcher: Function
) => {
  if (entry.type === 'directory') {
    const dirPath = resolve(path, entry.name);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    if (entry.children) {
      await parseFileTree(entry.children, dirPath, fetcher);
    }
  } else if (entry.type === 'file') {
    await downloadFile(entry, path, fetcher);
  }
};

const parseFileTree = async (
  fileTree: FileTree[],
  path: string,
  fetcher: Function
) => {
  for (let entry of fileTree) {
    await parseFileTreeEntry(entry, path, fetcher);
  }
};

const countFileTreeLength = (fileTree: FileTree[]) => {
  let count = 0;

  for (let entry of fileTree) {
    if (entry.children && entry.type === 'directory') {
      count += countFileTreeLength(entry.children);
    } else {
      count += 1;
    }
  }

  return count;
};

async function init() {
  const vercelAccessToken = getAccessToken();
  const outputDirectory = await getOutputDirectory();
  const user = await getUser(vercelAccessToken);
  const teams = await getTeams(vercelAccessToken);

  const teamChoices: prompts.Choice[] = teams.map((team) => {
    return {
      title: team.name,
      description: `${team.membership.role}`,
      value: team.id
    };
  });

  const personalChoice: prompts.Choice = {
    title: user.username,
    description: 'Personal account',
    value: -1
  };

  const chooseTeam = await prompts({
    type: 'select',
    name: 'value',
    message: 'Pick a team',
    choices: [personalChoice].concat(teamChoices)
  });

  const teamId = chooseTeam.value as string;

  const deployments = await getDeployments(vercelAccessToken, teamId);

  const chooseDeployment = await prompts({
    type: 'select',
    name: 'value',
    message: 'Pick a deployment',
    choices: deployments.map((deployment) => {
      const age = dayjs(deployment.ready).from(dayjs());

      return {
        title: deployment.url,
        description: `${deployment.target} (${age})`,
        value: deployment
      };
    })
  });

  const deployment = chooseDeployment.value as Deployment;

  checkDeploymentSource(deployment);

  log('Downloading files from deployment:', deployment.url);

  const files = await getDeploymentFiles(vercelAccessToken, teamId, deployment);

  const totalFileTreeLength = countFileTreeLength(files);

  log(`Total files to download: ${totalFileTreeLength}`);

  if (!fs.existsSync(outputDirectory)) {
    fs.mkdirSync(outputDirectory);
  }

  const fetcher = fileContentFetcher(vercelAccessToken, teamId, deployment);
  await parseFileTree(files, outputDirectory, fetcher);
}

init().catch((e) => {
  console.error(e);
});
