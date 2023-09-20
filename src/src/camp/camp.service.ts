// camp.service.ts
import { Injectable } from '@nestjs/common';

import { UserService } from 'src/user/user.service';
import { HasuraService } from '../hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';
import { UploadFileService } from 'src/upload-file/upload-file.service';

@Injectable()
export class CampService {
	constructor(
		private userService: UserService,
		private hasuraService: HasuraService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
		private uploadFileService: UploadFileService,
	) {}

	public returnFieldsgroups = ['id', 'name', 'type', 'status'];

	public returnFieldscamps = [
		'kit_received',
		'kit_was_sufficient',
		'kit_ratings',
		'kit_feedback',
		'group_id',
	];

	public returnFieldsgroupUsers = ['group_id', 'id'];

	public returnFieldsProperties = ['id'];

	async create(body: any, request: any, response: any) {
		try {
			let facilitator_id = request.mw_userid;
			let learner_ids = body?.learner_ids;
			let program_id = body?.program_id || 1;
			let academic_year_id = body?.academic_year_id || 1;
			let beneficiary_status = 'enrolled_ip_verified';
			let createcampResponse: any;
			let creategroupwoner: any;

			let facilitator_status = await this.checkFaciltatorStatus(
				facilitator_id,
				program_id,
				academic_year_id,
			);
			if (
				facilitator_status?.data?.users_aggregate?.aggregate?.count == 0
			) {
				return response.status(401).json({
					success: false,
					data: {},
					message:
						'CAMP_VALIDATION_MESSAGE_FACILITATOR_DIDNT_SHORTLISTED_FOR_ORIENTATION,',
				});
			}

			// check if faciltator have more than one camps

			let faciltator_camp_data = await this.checkCampInformation(
				facilitator_id,
				program_id,
				academic_year_id,
			);
			if (
				faciltator_camp_data?.data?.camps_aggregate?.aggregate?.count >
				1
			) {
				return response.status(401).json({
					success: false,
					data: {},
					message:
						'CAMP_VALIDATION_MESSAGE_REGISTRATION_LIMIT_EXCEED',
				});
			}

			//check if learners belongs to same prerak and have status 'enrolled_ip_verified'

			let query = `query MyQuery {
				users(where:{program_beneficiaries:{user_id: {_in:[${learner_ids}]},status:{_eq:${beneficiary_status}}, facilitator_id: {_eq:${facilitator_id}}}}){
				  id
				}
			  }`;

			const data = { query: query };
			const res = await this.hasuraServiceFromServices.getData(data);
			let learner_data = res?.data?.users;

			// Check if learner_data is defined
			if (
				!learner_data ||
				!Array.isArray(learner_data) ||
				learner_data.length === 0
			) {
				return response.status(400).json({
					success: false,
					message: 'CAMP_VALIDATION_MESSAGE_LEARNER_ID_DOESNT_EXIST',
				});
			}

			// Check if facilitator_id and learner_data have the same length
			if (learner_ids.length !== learner_data.length) {
				return response.status(400).json({
					success: false,
					message:
						'CAMP_VALIDATION_MESSAGE_LEARNER_ALREADY_ADDED_WITH_ANOTHER_PRERAK',
				});
			}

			let create_group_object = {
				name:
					'camp ' +
					faciltator_camp_data?.data?.camps_aggregate?.aggregate
						?.count +
					1,
				type: 'camp',
				status: 'not_registered',
				program_id: body?.program_id || 1,
				academic_year_id: body?.academic_year_id || 1,
				created_by: facilitator_id,
				updated_by: facilitator_id,
			};
			let createresponse = await this.hasuraService.q(
				'groups',
				{
					...create_group_object,
				},
				[],
				false,
				[...this.returnFieldsgroups, 'id', 'name', 'type', 'status'],
			);

			let group_id = createresponse?.groups?.id;
			if (group_id) {
				let camp_request_json = {
					group_id: createresponse?.groups?.id,
					created_by: facilitator_id,
					updated_by: facilitator_id,
				};

				createcampResponse = await this.hasuraService.q(
					'camps',
					{
						...camp_request_json,
					},
					[],
					false,
					[...this.returnFieldscamps, 'group_id', 'id'],
				);
			}

			let camp_id = createcampResponse?.camps?.id;

			if (!camp_id) {
				if (group_id) {
					await this.hasuraService.delete('groups', {
						id: group_id,
					});
				}

				return response.status(500).json({
					success: false,
					message: 'CAMP_VALIDATION_MESSAGE_CREATING_CAMP_DETAILS',
					data: {},
				});
			}

			// Add group user details for owner or faciltator

			let group_user_owner = {
				group_id: group_id,
				user_id: facilitator_id,
				member_type: 'owner',
				status: 'active',
				created_by: facilitator_id,
				updated_by: facilitator_id,
			};

			creategroupwoner = await this.hasuraService.q(
				'group_users',
				{
					...group_user_owner,
				},
				[],
				false,
				[...this.returnFieldsgroupUsers, 'group_id', 'id'],
			);

			if (!creategroupwoner?.group_users?.id) {
				await this.hasuraService.delete('camps', {
					id: camp_id,
				});

				await this.hasuraService.delete('groups', {
					id: group_id,
				});

				return response.status(500).json({
					success: false,
					message: 'CAMP_VALIDATION_MESSAGE_CREATING_USER_FOR_CAMP',
					data: {},
				});
			}

			let group_user_member = {
				group_id: group_id,
				member_type: 'member',
				status: 'active',
				created_by: facilitator_id,
				updated_by: facilitator_id,
			};

			//add learners to the group users

			learner_ids.forEach(async (id) => {
				await this.hasuraService.q(
					'group_users',
					{
						...group_user_member,
						user_id: id,
					},
					[],
					false,
					[...this.returnFieldsgroupUsers, 'group_id', 'id'],
				);
			});

			const auditData = {
				userId: facilitator_id,
				mw_userid: facilitator_id,
				context: 'camp',
				context_id: camp_id,
				oldData: {
					group_id: group_id,
					status: 'not_registered',
					learner_id: [learner_ids],
				},
				newData: {
					group_id: group_id,
					status: 'not_registered',
					learner_id: [learner_ids],
				},
				tempArray: ['group_id', 'status', 'learner_id'],
				action: 'create',
			};

			await this.userService.addAuditLogAction(auditData);

			return response.status(200).json({
				success: true,
				data: { camp: createcampResponse.camps },
				message: 'Camp registered successfully.',
			});

			// Return a success response if everything is okay
		} catch (error) {
			// Handle any other errors that might occur during execution
			return response.status(500).json({
				success: false,
				message: 'An error occurred during camp registration.',
				error: error.message,
			});
		}
	}

	async checkCampInformation(
		id: any,
		program_id: any,
		academic_year_id: any,
	) {
		let facilitator_id = id;
		let facilitator_id_program_id = program_id;
		let facilitator_id_academic_id = academic_year_id;
		let query = `query MyQuery {
			camps_aggregate(where: {group_users: {status: {_eq: "active"}, member_type: {_eq: "owner"}, user_id: {_eq: ${facilitator_id}}, group: {academic_year_id: {_eq:${facilitator_id_academic_id}}, program_id: {_eq:${facilitator_id_program_id}}}}}) {
			  aggregate {
				count
			  }
			}
		  }
		  
          
          `;
		const data = { query: query };
		const res = await this.hasuraServiceFromServices.getData(data);
		return res;
	}

	async checkFaciltatorStatus(
		id: any,
		program_id: any,
		academic_year_id: any,
	) {
		let facilitator_id = id;
		let facilitator_id_program_id = program_id;
		let facilitator_id_academic_id = academic_year_id;
		let status = 'shortlisted_for_orientation';

		let query = `query MyQuery {
      users_aggregate(where: {id: {_eq: ${facilitator_id}}, program_faciltators: {status: {_eq:${status}}, program_id: {_eq:${facilitator_id_program_id}}, academic_year_id: {_eq:${facilitator_id_academic_id}}}}) {
        aggregate {
          count
        }
      }
    }
    
      `;
		const data = { query: query };
		const res = await this.hasuraServiceFromServices.getData(data);
		return res;
	}

	public async campList(body: any, req: any, resp) {
		const facilitator_id = req.mw_userid;
		let program_id = body?.program_id || 1;
		let academic_year_id = body?.academic_year_id || 1;
		let member_type = 'owner';
		let status = 'active';

		let qury = `query MyQuery {
			camps(where: {group_users: {group: {academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}}, user: {}, member_type: {_eq:${member_type}}, status: {_eq:${status}}, user_id: {_eq:${facilitator_id}}}}) {
			  id
			  kit_ratings
			  kit_feedback
			  kit_received
			  kit_was_sufficient
			  group{
				name
				description
				status
			  }
			  
			  group_users(where: {member_type: {_neq: "owner"}}) {
				user_id
				status
				member_type
				
			  }
			}
		  }`;

		const data = { query: qury };
		const response = await this.hasuraServiceFromServices.getData(data);
		const newQdata = response?.data;

		return resp.status(200).json({
			success: true,
			message: 'Data found successfully!',
			data: newQdata,
		});
	}

	public async campById(id: any, body: any, req: any, resp) {
		const camp_id = id;
		const facilitator_id = req.mw_userid;
		let program_id = body?.program_id || 1;
		let academic_year_id = body?.academic_year_id || 1;
		let member_type = 'owner';
		let status = 'active';

		let qury = `query MyQuery {
			camps(where: {id:{_eq:${camp_id}},group_users: {group: {academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}},member_type: {_eq:${member_type}}, status: {_eq:${status}}, user_id: {_eq:${facilitator_id}}}}) {
			  id
			  kit_ratings
			  kit_feedback
			  kit_received
			  kit_was_sufficient
			  group{
				name
				description
				status
			  }
			  properties{
				lat
				long
				street
				state
				district
				block
				village
				grampanchayat
				property_type
				property_facilities
				property_photo_building
				property_photo_classroom
				property_photo_other
			  }
			  
			  group_users(where: {member_type: {_neq: "owner"}}) {
				user {
				  id
				  profile_photo_1: documents(where: {document_sub_type: {_eq: "profile_photo_1"}}) {
					id
					name
					doument_type
					document_sub_type
					path
				  }
				  program_beneficiaries {
					user_id
					status
					enrollment_first_name
					enrollment_last_name
					enrollment_middle_name
				  }
				}
			  }
			}
		  }
		  
		  
		  `;
		const data = { query: qury };
		const response = await this.hasuraServiceFromServices.getData(data);
		const newQdata = response?.data?.camps;

		if (newQdata.length == 0) {
			return resp.status(400).json({
				success: false,
				message: 'Camp data not found!',
				data: {},
			});
		}

		const userData = await Promise.all(
			newQdata?.map(async (item) => {
				const group_users = await Promise.all(
					item.group_users.map(async (userObj) => {
						userObj = userObj.user;
						let profilePhoto = userObj.profile_photo_1;
						if (profilePhoto?.[0]?.id !== undefined) {
							const { success, data: fileData } =
								await this.uploadFileService.getDocumentById(
									userObj.profile_photo_1[0].id,
								);
							if (success && fileData?.fileUrl) {
								userObj.profile_photo_1 = {
									id: userObj.profile_photo_1[0]?.id,
									name: userObj.profile_photo_1[0]?.name,
									doument_type:
										userObj.profile_photo_1[0]
											?.doument_type,
									document_sub_type:
										userObj.profile_photo_1[0]
											?.document_sub_type,
									path: userObj.profile_photo_1[0]?.path,
									fileUrl: fileData.fileUrl,
								};
							}
						} else {
							userObj.profile_photo_1 = {};
						}

						return userObj;
					}),
				);
				return { ...item, group_users };
			}),
		);
		const userResult = userData?.[0];
		if (!userResult?.properties) {
			userResult.properties = {
				lat: null,
				long: null,
				street: null,
				state: null,
				district: null,
				block: null,
				village: null,
				grampanchayat: null,
				property_type: null,
				property_facilities: null,
				property_photo_building: null,
				property_photo_classroom: null,
				property_photo_other: null,
			};
		}
		return resp.status(200).json({
			success: true,
			message: 'Data found successfully!',
			data: userData || {},
		});
	}

	public async updateCampDetails(
		id: any,
		body: any,
		request: any,
		response: any,
	) {
		let camp_id = id;
		let facilitator_id = request.mw_userid;
		let status = 'active';
		let member_type = 'owner';
		let update_body = body;

		const PAGE_WISE_UPDATE_TABLE_DETAILS = {
			edit_location: {
				properties: [
					'lat',
					'long',
					'street',
					'grampanchayat',
					'state',
					'district',
					'block',
					'village',
					'property_type',
				],
			},
			edit_facilities: {
				properties: ['property_facilities'],
			},
			edit_kit: {
				kit_received: ['kit_received'],
				kit_details: [
					'kit_received',
					'kit_was_sufficient',
					'kit_ratings',
					'kit_feedback',
				],
			},
			edit_photo_details: {
				properties: [
					'property_photo_building',
					'property_photo_classroom',
					'property_photo_other',
				],
			},
		};

		// check if the camp for camp_id exists

		let query = `query MyQuery {
			camps_by_pk(id:${camp_id}) {
			  id
			  property_id
			  properties {
				lat
				long
			  }
			  group_users(where: {user_id: {_eq:${facilitator_id}}, member_type: {_eq:${member_type}}, status: {_eq:${status}}}) {
				id
				user_id
				
			  }
			}
		  }
		  
		  `;

		const data = { query: query };
		const hasura_response = await this.hasuraServiceFromServices.getData(
			data,
		);
		const campData = hasura_response?.data.camps_by_pk;

		if (!campData?.id) {
			return response.status(400).json({
				success: false,
				message: 'CAMP_NOT_EXISTS_ERROR',
				data: {},
			});
		}

		if (campData?.group_users[0]?.user_id != facilitator_id) {
			return response.status(401).json({
				success: false,
				message: 'CAMP_UPDATE_ACTION_DENIED',
				data: {},
			});
		}

		let property_id = campData?.property_id;

		if (!property_id) {
			const { data, status, message } = await this.createPropertyDetails(
				camp_id,
				{
					created_by: facilitator_id,
					updated_by: facilitator_id,
				},
				['created_by', 'updated_by'],
			);
			if (status === 500) {
				return response.status(status).json({
					success: false,
					message,
					data,
				});
			} else {
				property_id = data?.property_id;
			}
		}

		switch (update_body.edit_page_type) {
			case 'edit_camp_location': {
				let bodyData = update_body;
				if (campData?.properties.lat || campData?.properties.long) {
					let { lat, long, ...otherData } = update_body;
					bodyData = otherData;
				}
				let location_body = {
					...bodyData,
					updated_by: facilitator_id,
				};
				const location_arr =
					PAGE_WISE_UPDATE_TABLE_DETAILS.edit_location.properties;

				await this.updatepropertyDetails(
					camp_id,
					property_id,
					location_body,
					[...location_arr, 'updated_by'],
					response,
				);

				break;
			}

			case 'edit_kit_details': {
				let camp_details = {
					...update_body,
				};

				const kit_arr =
					camp_details.kit_received === 'yes'
						? PAGE_WISE_UPDATE_TABLE_DETAILS.edit_kit.kit_details
						: PAGE_WISE_UPDATE_TABLE_DETAILS.edit_kit.kit_received;

				await this.updateCampData(
					camp_id,
					camp_details,
					kit_arr,
					response,
				);

				break;
			}

			case 'edit_photo_details': {
				const photo_details_arr =
					PAGE_WISE_UPDATE_TABLE_DETAILS.edit_photo_details
						.properties;
				let photo_details_body = {
					...update_body,
					updated_by: facilitator_id,
				};
				await this.updatepropertyDetails(
					camp_id,
					property_id,
					photo_details_body,
					[...photo_details_arr, 'updated_by'],
					response,
				);
				break;
			}

			case 'edit_property_facilities': {
				let camp_facilities = {
					property_facilities: update_body?.facilities
						? JSON.stringify(update_body.facilities).replace(
								/"/g,
								'\\"',
						  )
						: '',
				};
				const facilities_arr =
					PAGE_WISE_UPDATE_TABLE_DETAILS.edit_facilities.properties;

				await this.updatepropertyDetails(
					camp_id,
					property_id,
					{ ...camp_facilities, updated_by: facilitator_id },
					[...facilities_arr, 'updated_by'],
					response,
				);

				break;
			}
		}
	}

	async createPropertyDetails(camp_id: any, body: any, create_arr: any) {
		let create_response = await this.hasuraService.q(
			'properties',
			body,
			create_arr,
			false,
			[...this.returnFieldsProperties, 'id'],
		);

		let property_id = create_response?.properties?.id;

		if (!property_id) {
			return {
				status: 500,
				message: 'Error creating property details',
				data: {},
			};
		}

		const camp_update_body = {
			property_id: property_id,
		};

		const update_response = await this.hasuraService.q(
			'camps',
			{
				...camp_update_body,
				id: camp_id,
			},
			[],
			true,
			[...this.returnFieldscamps, 'property_id', 'id'],
		);

		const update_camp_id = update_response?.camps?.id;

		if (!update_camp_id) {
			if (property_id) {
				await this.hasuraService.delete('properties', {
					id: property_id,
				});
			}

			return {
				status: 500,
				message: 'Error updating camps property details',
				data: {},
			};
		}

		return {
			status: 200,
			message: 'Updated camp details successfully  ',
			data: update_response?.camps,
		};
	}

	async updatepropertyDetails(
		camp_id: any,
		property_id: any,
		body: any,
		update_array: any,
		response: any,
	) {
		await this.hasuraService.q(
			'properties',
			{
				...body,
				id: property_id,
			},
			update_array,
			true,
			[...this.returnFieldsProperties, 'id'],
		);

		return response.json({
			status: 200,
			message: 'Successfully updated camp details',
			data: camp_id,
		});
	}

	async updateCampData(
		camp_id: any,
		camp_body: any,
		update_arr: any,
		response: any,
	) {
		await this.hasuraService.q(
			'camps',
			{
				...camp_body,
				id: camp_id,
			},
			update_arr,
			true,
			[...this.returnFieldscamps, 'id'],
		);

		return response.json({
			status: 200,
			message: 'Successfully updated camp details',
			data: camp_id,
		});
	}
}
