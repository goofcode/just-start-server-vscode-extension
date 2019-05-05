"use strict";

import { ConfigurationAccessor, accessor, ConfigApplication } from "./configuration";

import Tomcat from "../apps/Tomcat";
import SpringBoot from "../apps/SpringBoot";
import { OutputChannel, Uri } from "vscode";
import { getMessage, existsCode } from "../messages";

/**
 * This Enum represents the type of application.
 * Normally, you can not change the value once set.
 */
export enum AppTypes {
    TOMCAT = "TOMCAT",
    SPRING_BOOT = "SPRING_BOOT",
}

export function findClassModule(type: AppTypes) {
    switch (type) {
        case AppTypes.TOMCAT: return Tomcat;
        case AppTypes.SPRING_BOOT: return SpringBoot;
        default: throw new ApplicationError(ApplicationError.NoValidAppType);
    }
}

/**
 * This enum represents the state of the application.
 * The string value of Enum is used in "view/item/context" in the packge.json file.
 */
export enum Status {
    RUNNING = "running",
    PREPARING = "preparing",
    STOP = "stop",
}

/**
 * IRunnable interface for application define.
 */
export interface IRunnable {
    init(): Promise<void>;

    deploy(outputChannel?: OutputChannel): Promise<void>;
    dispose(): Promise<void>;
    start(outputChannel: OutputChannel): Promise<void>;
    stop(outputChannel: OutputChannel): Promise<void>;
    debug(outputChannel: OutputChannel): Promise<void>;
    validateSource?(version?: string): Promise<boolean>;

    findVersion(): Promise<string>;

    getId(): string;
    getName(): string;
    getAppPath(): string;
    getStatus(): Status;
    getServicePort(): number;
    getIconPath?(asAbsolutePath: (relativePath: string) => string): { dark: string, light: string } | string;
    getDebugSessionName(): string;

    type: AppTypes;
    status: Status;
}

export async function validateExecutableApplication(type: AppTypes, path: string, version?: string) {
    const App: any = findClassModule(type);
    const app = new App("xx", container.getWorkspaceUri()) as (IRunnable & ConfigurationAccessor);
    app.config.appPath = path;
    if (app.validateSource) {
        return await app.validateSource(version);
    }
    return true;
}

export class ApplicationError extends Error {
    constructor(
        public readonly msg: string,
        public readonly code?: string
    ) {
        super(msg);
    }

    toString() {
        if (this.code && existsCode(this.code)) {
            return `${getMessage(this.code)}${this.msg ? " (" + this.msg + ")" : ""}`;
        } else if (existsCode(this.msg)) {
            return getMessage(this.msg);
        } else {
            return this.msg;
        }
    }

    public static FatalFailure = "E_AP_FAIL";
    public static NotReady = "E_AP_NTRY";
    public static NotFound = "E_AP_NTFN";
    public static NotFoundTargetDeploy =  "E_AP_NFTD";
    public static NotMatchConfDeploy = "E_AP_NMSC";
    public static NotFoundWorkspace = "E_AP_NFWS";
    public static NoValidAppType = "E_AP_NVAT";
    public static NotAvailablePort = "E_AP_NAVP";
    public static InaccessibleResources = "E_AP_IACR";
    public static InvalidInternalResource = "E_AP_IVIR";
}

export namespace container {
    let uri: Uri;
    const _cache: (IRunnable & ConfigurationAccessor)[] = [];

    export function initialize(_uri: Uri): void {
        uri = _uri;
    }

    export function getWorkspaceUri() {
        return uri;
    }

    export function reset() {
        _cache.length = 0;
    }

    export async function createApplication(type: AppTypes, id?: string): Promise<IRunnable & ConfigurationAccessor> {
        if (!uri) { throw new ApplicationError(ApplicationError.NotFoundWorkspace); }
        id = id || "App" + Date.now();
        const App: any = findClassModule(type);
        return new App(id, uri);
    }

    export async function loadFromConfigurations(exactly?: boolean): Promise<void> {
        const config = await accessor.readConfigFile();
        if (exactly) { _cache.length = 0; }

        if (config.apps.some(app => !app.appPath)) {
            await config.apps.forEach(async (app, i) => {
                if (!app.appPath) {
                    await accessor.detachConfigApplication(app.id);
                    (config.apps as any)[i] = undefined;
                }
            });
        }
        const appConfigs = config.apps
            .filter(app => app !== undefined)
            .filter(app => !_cache.some(loaded => loaded.getId() === app.id));

        const apps: Array<IRunnable & ConfigurationAccessor> = [];
        let tempConf;
        for (tempConf of appConfigs) {
            apps.push(await _initializeApplication(tempConf));
        }

        await accessor.writeConfigApplication(apps.map(app => app.config));
        setAppsToContainer(apps);
        return void 0;
    }

    async function _initializeApplication(config: ConfigApplication): Promise<IRunnable & ConfigurationAccessor> {
        const app = await createApplication(AppTypes[config.type as AppTypes], config.id);
        const pure = [...app.getProperties()];
        app.setConfig(config);

        const prev = config.properties;
        app.config.properties = pure.map(p => prev.some(pv => pv.key === p.key && !!pv.changeable) ? prev.find(pv => pv.key === p.key)! : p);
        await app.init();

        return app;
    }

    export function setAppsToContainer(apps: Array<IRunnable & ConfigurationAccessor>): Array<IRunnable> {
        let temp;
        apps.forEach(app => {
            if (_cache.some(_a => _a.getId() === app.getId())) {
                temp = <IRunnable & ConfigurationAccessor>_cache.find(_a => _a.getId() === app.getId());
                temp.setConfig(app.config);
                // temp.init();
            } else {
                _cache.push(app);
            }
        });
        return _cache;
    }

    export function getApplication(id: string): undefined | (IRunnable & ConfigurationAccessor) {
        return _cache.find(_a => _a.getId() === id);
    }

    export function getApplications(): (IRunnable & ConfigurationAccessor)[] {
        return _cache;
    }

}