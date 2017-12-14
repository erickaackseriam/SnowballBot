import { Whitelist } from "../../whitelist/whitelist";
import { EmbedType, getLogger } from "../../utils/utils";
import { generateLocalizedEmbed, localizeForUser } from "../../utils/ez-i18n";
import { ISimpleCmdParseResult, simpleCmdParse, stripSpaces } from "../../utils/text";
import { Plugin } from "../../plugin";
import PrefixAll from "./prefixAll";
import { IModule, ModuleBase } from "../../../types/ModuleLoader";
import { Guild, Message } from "discord.js";
import { randomNumber, randomPick } from "../../utils/random";

/*
	private subcmd_add(msg: Message, parsed: ISimpleCmdParseResult) {
		// 
	}

	private subcmd_remove(msg: Message, parsed: ISimpleCmdParseResult) {
		//
	}

	private subcmd_list(msg: Message, parsed: ISimpleCmdParseResult) {
		//
	}
*/

const DEFAULT_LIMITATIONS = <IPrefixAllPluginLimitations>{
	non_partners: 1, // 1 additional prefix?
	partners: 5
};

export const ATTEMPTS_STARS = ["https://i.imgur.com/XgY13z9.png", "https://i.imgur.com/0NJqMTo.png", "https://i.imgur.com/oWjUCrH.png", "https://i.imgur.com/Zfpy5Sj.png"];

export const PREFIXALL_PLUGIN_SIGNATURE = "snowball.core_features.prefixall.plugin";

let instanceInitialized = false;

export default class PrefixAllPlugin extends Plugin implements IModule {
	public get signature() {
		return PREFIXALL_PLUGIN_SIGNATURE;
	}

	private prefixAllKeeper: ModuleBase<PrefixAll>;
	private whitelistKeeper: ModuleBase<Whitelist>;
	private log = getLogger("PrefixAllPlugin");
	private allowNoWhitelistHandling = false;
	private limitations: IPrefixAllPluginLimitations;

	constructor(options: IPrefixAllPluginOptions) {
		super({
			"message": (msg) => this.onMessage(msg)
		}, true);

		if(instanceInitialized) {
			throw new Error("Could not initializate the prefix all plugin another time. Only one instance could work at the same time");
		}

		this.allowNoWhitelistHandling = !!options.allowNoWhitelistHandling;
		this.limitations = options.limitations && (options.limitations.non_partners && options.limitations.partners) ? options.limitations : DEFAULT_LIMITATIONS;
	}

	public async init() {
		this.log("info", "Searching for `PrefixAll` core keeper");
		const prefixAllKeeper = $snowball.modLoader.loadedModulesRegistry["snowball.core_features.prefixall"];
		if(!prefixAllKeeper) {
			this.log("err", "Keeper not found, could not load");
			return; // should throw?
		}
		this.prefixAllKeeper = prefixAllKeeper;

		this.log("info", "Searching for `Whitelist` core keeper");
		const whitelistKeeper = $snowball.modLoader.loadedModulesRegistry["snowball.core_features.whitelist"];

		if(whitelistKeeper) {
			this.whitelistKeeper = whitelistKeeper;
		} else {
			this.log("warn", "Whitelist keeper not found");
		}

		instanceInitialized = true;
	}

	private async onMessage(msg: Message) {
		// TODO: the current method is extra costly, should attach instance to the events
		// currently slighty optimizing this query by removing state checking
		if(!this.prefixAllKeeper) { return; }
		// for later usage and ensurance of non-null value of instance creating the constant
		// (!) this is probably memory costly as it's getting executing for every message
		const prefixAllInstance = this.prefixAllKeeper.base;
		if(!prefixAllInstance) { return; } // no instance means errored loading, or invalid state

		const prefix = await prefixAllInstance.checkPrefix(msg);
		if(!prefix) { return; } // prefix not found, returning

		const parsed = simpleCmdParse(msg.content.slice(prefix.length));
		if(parsed.command !== "prefix") { return; } // checking if there's no command call

		if(!parsed.subCommand) { // if there's no subcommand then sending helpful message
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREFIXALL_INFO")
			});
		}

		switch(parsed.subCommand.toLowerCase()) { // otherwise let's switch to the best one
			// TODO: (done) passing instance of prefixall instead of repetitive searching and checking \
			// if instance is already loaded. Improves some .ms time.
			case "add": case "+": return await this.subcmd_add(msg, parsed, prefix, prefixAllInstance);
			case "remove": case "-": return await this.subcmd_remove(msg, parsed, prefix, prefixAllInstance);
			case "list": case "?": return await this.subcmd_list(msg, parsed, prefix, prefixAllInstance);
		}
	}

	private async subcmd_add(msg: Message, parsed: ISimpleCmdParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		const cmd = `${prefix}${parsed.command}`;

		if(!parsed.args) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO_ADD",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const additionalPrefix = stripSpaces(msg.content.slice(cmd.length));

		const guildPrefixes = await this._getGuildPrefixes(prefixAllInstance, msg.guild);

		if(guildPrefixes.includes(additionalPrefix)) {
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_ALREAYADDED")
			});
		}

		const whitelistInstance = this.whitelistKeeper.base;

		if(!whitelistInstance && !this.allowNoWhitelistHandling) {
			this.log("warn", "`Whitelist` module instance not found!");
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, "PREFIXALL_PREFIX_INTERNALERROR")
			});
		}

		const limitation = whitelistInstance && (await whitelistInstance.isWhitelisted(msg.guild)).state === -1 ? this.limitations.partners : this.limitations.non_partners;

		if(guildPrefixes.length >= limitation) { // inclusive
			return msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_PREFIX_LIMITEXCEED",
					formatOptions: {
						limit: guildPrefixes.length
					}
				})
			});
		}

		guildPrefixes.push(additionalPrefix);

		await prefixAllInstance.setPrefixes(msg.guild, guildPrefixes);

		return await msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
				key: "PREFIXALL_PREFIX_ADDED",
				formatOptions: {
					prefix: additionalPrefix
				}
			})
		});
	}

	private async subcmd_remove(msg: Message, parsed: ISimpleCmdParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		const cmd = `${prefix}${parsed.command}`;

		if(!parsed.args) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO_REMOVE",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const prefixToRemoval = stripSpaces(msg.content.slice(cmd.length));

		const guildPrefixes = await this._getGuildPrefixes(prefixAllInstance, msg.guild);

		if(guildPrefixes.length === 1) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, "PREFIXALL_PREFIX_CANTREMOVELATEST")
			});
		}
		
		const index = guildPrefixes.indexOf(prefixToRemoval);

		if(index === -1) {
			const star = randomNumber(0, 7) === 6;
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Error, msg.member, {
					custom: true,
					string: (await localizeForUser(msg.member, "PREFIXALL_PREFIX_NOTFOUND")) + (star ? ("\n" + await localizeForUser(msg.member, "PREFIXALL_PREFIX_NOTFOUND_6")) : "")
				}, star ? {
					imageUrl: randomPick(ATTEMPTS_STARS)
				}: undefined)
			});
		}

		guildPrefixes.splice(index, 1);

		await prefixAllInstance.setPrefixes(msg.guild, guildPrefixes);

		return await msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.OK, msg.member, {
				key: "PREFIXALL_PREFIX_REMOVED",
				formatOptions: {
					prefix: prefixToRemoval
				}
			})
		});
	}

	private async subcmd_list(msg: Message, parsed: ISimpleCmdParseResult, prefix: string, prefixAllInstance: PrefixAll) {
		const cmd = `${prefix}${parsed.command}`;

		if(parsed.args) {
			return await msg.channel.send({
				embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
					key: "PREFIXALL_INFO_LIST",
					formatOptions: {
						prefix: `${cmd} ${parsed.subCommand}`
					}
				})
			});
		}

		const guildPrefixes = await this._getGuildPrefixes(prefixAllInstance, msg.guild);

		const items:string[] = [];
		
		for(const prefix of guildPrefixes) {
			items.push(await localizeForUser(msg.member, "PREFIXALL_PREFIX_LISTITEM", {
				prefix
			}));
		}

		return await msg.channel.send({
			embed: await generateLocalizedEmbed(EmbedType.Information, msg.member, {
				key: "PREFIXALL_PREFIX_LIST",
				formatOptions: {
					items: items.join("\n")
				}
			})
		});
	}

	/**
	 * With default prefix fallback
	 */
	private async _getGuildPrefixes(prefixAllInstance: PrefixAll, guild: Guild) {
		const arr = [prefixAllInstance.defaultPrefix];
		const guildPrefixes = await prefixAllInstance.getPrefixes(guild);
		return guildPrefixes ? arr.concat(guildPrefixes) : arr; // no ["!", undefined] pls
	}

	public async unload() {
		instanceInitialized = false;
		return true;
	}
}

interface IPrefixAllPluginLimitations {
	/**
	 * For non-partnered / not whitelisted servers
	 */
	non_partners: number;
	/**
	 * For partners / whitelisted servers
	 */
	partners: number;
}

interface IPrefixAllPluginOptions {
	/**
	 * Limitations of prefixes.
	 * Allowing to have many prefixes to everyone could case many performance problems for depending plugins. Recommended count - less than 5 prefixes.
	 */
	limitations: IPrefixAllPluginLimitations;
	/**
	 * Allows handling prefix adding requests when whitelist module not found.
	 * If disabled (default), prints error and denies request.
	 */
	allowNoWhitelistHandling: boolean;
}

module.exports = PrefixAllPlugin;