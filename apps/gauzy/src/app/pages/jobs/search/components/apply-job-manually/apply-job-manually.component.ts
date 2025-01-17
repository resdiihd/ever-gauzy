import { AfterViewInit, Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, FormGroupDirective, Validators } from '@angular/forms';
import { Subject, combineLatest } from 'rxjs';
import { debounceTime, filter, tap } from 'rxjs/operators';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { NbDialogRef } from '@nebular/theme';
import { TranslateService } from '@ngx-translate/core';
import { CKEditor4 } from 'ckeditor4-angular';
import { FileUploader, FileUploaderOptions } from 'ng2-file-upload';
import {
	IApplyJobPostInput,
	IEmployee,
	IEmployeeJobPost,
	IEmployeeProposalTemplate,
	IImageAsset,
	IOrganization,
	ISelectedEmployee,
	IUser,
	JobPostSourceEnum
} from '@gauzy/contracts';
import { distinctUntilChange, isNotEmpty } from '@gauzy/common-angular';
import { JobService, Store, ToastrService } from './../../../../../@core/services';
import { API_PREFIX } from './../../../../../@core/constants';
import { FormHelpers } from './../../../../../@shared/forms';
import { TranslationBaseComponent } from './../../../../../@shared/language-base';
import { ckEditorConfig } from './../../../../../@shared/ckeditor.config';

@UntilDestroy({ checkProperties: true })
@Component({
	selector: 'ga-apply-job-manually',
	templateUrl: './apply-job-manually.component.html',
	styleUrls: ['./apply-job-manually.component.scss']
})
export class ApplyJobManuallyComponent extends TranslationBaseComponent
	implements AfterViewInit, OnInit, OnDestroy {

	public JobPostSourceEnum: typeof JobPostSourceEnum = JobPostSourceEnum;
	public FormHelpers: typeof FormHelpers = FormHelpers;
	public ckConfig: CKEditor4.Config = ckEditorConfig;
	public organization: IOrganization;
	public uploader: FileUploader;
	public hasDropZoneOver: boolean = false;
	public loading: boolean = false;
	public proposal$: Subject<boolean> = new Subject();
	public proposalTemplate: IEmployeeProposalTemplate;

	/** Apply Job Manually Mutation Form */
	public form: FormGroup = ApplyJobManuallyComponent.buildForm(this.fb);
	static buildForm(fb: FormBuilder): FormGroup {
		return fb.group({
			proposal: [], // Cover Letter
			details: [], // Proposal details
			attachments: [],
			rate: [null, Validators.required], // Hourly Rate
			employeeId: [null, Validators.required]
		});
	}

	/**  Getter and setter for selected Employee */
	_selectedEmployee: ISelectedEmployee;
	get selectedEmployee(): ISelectedEmployee {
		return this._selectedEmployee;
	}
	@Input() set selectedEmployee(employee: ISelectedEmployee) {
		this._selectedEmployee = employee;

		/** Set default select employee */
		this.setDefaultEmployee(employee);
	}

	/**  Getter and setter for selected Job Post */
	_employeeJobPost: IEmployeeJobPost;
	get employeeJobPost(): IEmployeeJobPost {
		return this._employeeJobPost;
	}
	@Input() set employeeJobPost(value: IEmployeeJobPost) {
		this._employeeJobPost = value;
		this.patchFormValue();
	}

	/** Form group directive */
	@ViewChild('formDirective') formDirective: FormGroupDirective;

	constructor(
		private readonly fb: FormBuilder,
		private readonly dialogRef: NbDialogRef<ApplyJobManuallyComponent>,
		public readonly translateService: TranslateService,
		private readonly store: Store,
		private readonly jobService: JobService,
		private readonly toastrService: ToastrService
	) {
		super(translateService);
	}

	ngOnInit(): void {
		const storeUser$ = this.store.user$;
		const storeOrganization$ = this.store.selectedOrganization$;
		const storeEmployee$ = this.store.selectedEmployee$;
		combineLatest([storeOrganization$, storeEmployee$])
			.pipe(
				debounceTime(100),
				distinctUntilChange(),
				filter(([organization]) => !!organization),
				tap(([organization, employee]) => {
					this.organization = organization;
					this.selectedEmployee = employee && employee.id ? employee : null;
				}),
				untilDestroyed(this)
			)
			.subscribe();
		storeUser$
			.pipe(
				filter((user: IUser) => !!user),
				tap(() => this._loadUploaderSettings()),
				untilDestroyed(this)
			)
			.subscribe();
		this.proposal$
			.pipe(
				tap(() => this.generateEmployeeProposal()),
				untilDestroyed(this)
			)
			.subscribe();
	}

	ngAfterViewInit() {
		this.uploader.onSuccessItem = (item: any, response: string, status: number) => {
			try {
				if (response) {
					const image: IImageAsset = JSON.parse(response);
					if (image && image.id) {
						this.form.get('attachments').setValue(image.fullUrl);
						this.form.get('attachments').updateValueAndValidity();
					}
				}
			} catch (error) {
				console.log('Error while uploaded project files', error);
			}
		};
		this.uploader.onErrorItem = (item: any, response: string, status: number) => {
			try {
				if (response) {
					const error = JSON.parse(response);
					this.toastrService.danger(error);
				}
			} catch (error) {
				console.log('Error while uploaded project files error', error);
			}
		};
	}

	ngOnDestroy(): void { }

	private _loadUploaderSettings() {
		if (!this.store.user) {
			return;
		}
		const { token } = this.store;
		const { tenantId } = this.store.user;

		const headers: Array<{ name: string; value: string }> = [];
		headers.push({ name: 'Authorization', value: `Bearer ${token}` });
		headers.push({ name: 'Tenant-Id', value: tenantId });

		const uploaderOptions: FileUploaderOptions = {
			url: `${API_PREFIX}/image-assets/upload/proposal_attachments`,
			// XHR request method
			method: 'POST',
			// Upload files automatically upon addition to upload queue
			autoUpload: true,
			// Use xhrTransport in favor of iframeTransport
			isHTML5: true,
			// Calculate progress independently for each uploaded file
			removeAfterUpload: true,
			// XHR request headers
			headers: headers
		};
		this.uploader = new FileUploader(uploaderOptions);
	}

	public fileOverBase(e: any): void {
		this.hasDropZoneOver = e;
	}

	/**
	 * Patch job provider details after load page
	 */
	patchFormValue() {
		if (this.employeeJobPost) {
			const { providerCode, employee } = this.employeeJobPost;
			this.setDefaultEmployee(employee);

			const proposal = <FormControl>this.form.get('proposal');
			const details = <FormControl>this.form.get('details');

			/** Cover Letter required if job provider is Upwork */
			if (providerCode === JobPostSourceEnum.UPWORK) {
				proposal.setValidators([Validators.required]);
				details.setValidators(null);
			} else {
				proposal.setValidators(null);
				details.setValidators([Validators.required]);
			}
			this.form.updateValueAndValidity();
		}
	}

	/**
	 * On Proposal template change
	 *
	 * @param item
	 */
	onProposalTemplateChange(item: IEmployeeProposalTemplate | null): void {
		/** Generate proposal using GauzyAI */
		this.proposalTemplate = item || null;
		if (isNotEmpty(item)) {
			this.proposal$.next(true);
		}
	}

	/**
	 * On submit job proposal details
	 */
	onSubmit() {
		if (this.form.invalid) {
			return;
		}
		const { employeeId, proposal, rate, details, attachments } = this.form.value;
		const { providerCode, providerJobId } = this.employeeJobPost;

		/** Apply job post input */
		const applyJobPost: IApplyJobPostInput = {
			applied: true,
			employeeId,
			proposal,
			rate,
			details,
			attachments,
			providerCode,
			providerJobId
		};

		try {
			this.dialogRef.close(applyJobPost);
		} catch (error) {
			console.log('Error while applying job post', error);
		}
	}

	/** Set default employee for job apply */
	setDefaultEmployee(employee: ISelectedEmployee | IEmployee) {
		if (isNotEmpty(employee) && this.form.get('employeeId')) {
			this.form.get('employeeId').setValue(employee.id);
			this.form.get('employeeId').updateValueAndValidity();

			this.setDefaultEmployeeRates(employee);
		}
	}

	/** Set default employee rates */
	setDefaultEmployeeRates(employee: ISelectedEmployee | IEmployee) {
		if (employee && employee.billRateValue) {
			this.form.get('rate').setValue(employee.billRateValue);
			this.form.get('rate').updateValueAndValidity();
		}
	}

	/** Generate employee proposal text */
	public async generateEmployeeProposal() {
		/** Generate proposal for employee */
		const employeeId = this.form.get('employeeId').value;
		const rate = this.form.get('rate').value;

		const proposalTemplate = this.proposalTemplate.content;
		const jobPost = this.employeeJobPost.jobPost;
		const { id: employeeJobPostId, isActive, isArchived } = this.employeeJobPost;

		try {
			this.loading = true;
			/** Generate proposal request parameters */
			const generateProposalRequest = {
				employeeId: employeeId,
				proposalTemplate: proposalTemplate,
				employeeJobPostId: employeeJobPostId,
				jobPostId: jobPost.id,
				jobPost: jobPost,
				providerCode: jobPost.providerCode,
				providerJobId: jobPost.providerJobId,
				jobStatus: jobPost.jobStatus,
				jobType: jobPost.jobType,
				jobDateCreated: jobPost.jobDateCreated,
				rate: rate,
				isActive: isActive,
				isArchived: isArchived,
				attachments: "{}",
				qa: "{}",
				terms: "{}"
			}
			const employeeJobApplication = await this.jobService.generateEmployeeProposal(generateProposalRequest);

			/** If employee proposal generated successfully from Gauzy AI */
			if (isNotEmpty(employeeJobApplication)) {
				const { proposal } = employeeJobApplication;
				this.form.patchValue({ details: proposal, proposal: proposal });
			} else {
				this.form.patchValue({ proposal: proposalTemplate, details: proposalTemplate });
			}
		} catch (error) {
			/** Proposal text should be null, if proposal generation failed from Gauzy AI */
			this.form.patchValue({ proposal: null, details: null });
			console.error('Error while generating proposal text', error);
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Close dialog
	 */
	close() {
		this.dialogRef.close(false);
	}
}
